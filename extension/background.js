// Job Clipper — Background service worker
// Single writer for chrome.storage.local and single owner of all Trello calls.
// Content scripts and the popup/options pages talk to it via messages; the
// popup re-renders off storage.onChanged rather than writing storage itself.
//
// Works with no Trello connection at all: jobs save locally and the tracker UI
// runs as normal. Connecting Trello (options page) adds sync on top.

importScripts('trello.js');

// In-flight guard — prevents duplicate saves if two messages arrive before
// the first async storage write completes (e.g. rapid double-click)
const savingInFlight = new Set();

async function getJobs() {
  const data = await chrome.storage.local.get({ jobs: [] });
  return data.jobs;
}

async function setJobs(jobs) {
  await chrome.storage.local.set({ jobs });
}

async function getTrelloConfig() {
  const data = await chrome.storage.local.get({ trelloConfig: null });
  return data.trelloConfig;
}

// Only http(s) URLs may become job identities — anything else (javascript:,
// data:, garbage) would poison dedup and flow into hrefs and Trello cards.
function isValidJobUrl(url) {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

// Plain fetch/setTimeout don't reset the MV3 service-worker idle timer; a
// cheap extension-API call does. Used inside long Trello loops so the SW
// isn't reaped mid-batch.
function keepAlive() {
  return chrome.storage.local.get('__keepalive');
}

// ─── Message router ────────────────────────────────────────────────────────
const handlers = {
  SAVE_JOB: (msg) => handleSaveJob(msg.job),
  UPDATE_STATUS: (msg) => handleUpdateStatus(msg.url, msg.status),
  DELETE_JOB: (msg) => handleDeleteJob(msg.url),
  CLEAR_ALL: () => handleClearAll(),
  IMPORT_JOBS: (msg) => handleImportJobs(msg.jobs),
  TRELLO_STATE: () => handleTrelloState(),
  TRELLO_AUTH_URL: (msg) => handleTrelloAuthUrl(msg.key),
  TRELLO_CONNECT: (msg) => handleTrelloConnect(msg.key, msg.token),
  TRELLO_DISCONNECT: () => handleTrelloDisconnect(),
  TRELLO_SYNC_ALL: () => handleTrelloSyncAll()
};

// Handlers that read-modify-write the jobs array run strictly one at a time.
// Without this, two interleaved get→mutate→set sequences clobber each other
// (lost status updates, a CLEAR_ALL resurrected by an in-flight save) — easy
// to hit when messages queue up during a cold service-worker start.
const MUTATING = new Set(['SAVE_JOB', 'UPDATE_STATUS', 'DELETE_JOB', 'CLEAR_ALL', 'IMPORT_JOBS', 'TRELLO_SYNC_ALL']);
let mutationQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg.type];
  if (!handler) return false;

  let run;
  if (MUTATING.has(msg.type)) {
    run = mutationQueue.then(() => handler(msg), () => handler(msg));
    mutationQueue = run.then(() => {}, () => {});
  } else {
    run = handler(msg);
  }

  run
    .then(sendResponse)
    .catch(err => {
      console.error(`[JobClipper] ${msg.type} error:`, err);
      sendResponse({ ok: false, error: err.message });
    });
  return true; // keep channel open for async response
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

// ─── Jobs ──────────────────────────────────────────────────────────────────
async function handleSaveJob(job) {
  if (!isValidJobUrl(job.url)) return { ok: false, error: 'invalid url' };

  // Guard 1: in-memory — catches concurrent messages before storage is written
  if (savingInFlight.has(job.url)) return { ok: true, alreadySaved: true };
  savingInFlight.add(job.url);

  try {
    const jobs = await getJobs();

    // Guard 2: storage — catches duplicates across service-worker restarts
    if (jobs.some(j => j.url === job.url)) return { ok: true, alreadySaved: true };

    job.status = 'saved';
    jobs.unshift(job);
    await setJobs(jobs);

    const config = await getTrelloConfig();
    if (!config) return { ok: true, alreadySaved: false, local: true };

    try {
      // Guard 3: live board — catches the same job clipped from another device
      // (e.g. the phone Shortcut). Adopt the existing card instead of duplicating.
      const existingId = await trelloFindCardByUrl(job.url, config);
      const cardId = existingId || await trelloCreateCard(job, config);
      const fresh = await getJobs();
      const idx = fresh.findIndex(j => j.url === job.url);
      if (idx !== -1) {
        fresh[idx].trelloCardId = cardId;
        await setJobs(fresh);
      }
      return { ok: true, alreadySaved: !!existingId };
    } catch (e) {
      console.error('[JobClipper] Trello sync failed:', e.message);
      return { ok: true, alreadySaved: false, local: true }; // saved locally regardless
    }
  } finally {
    savingInFlight.delete(job.url);
  }
}

async function handleUpdateStatus(url, newStatus) {
  const jobs = await getJobs();
  const idx = jobs.findIndex(j => j.url === url);
  if (idx === -1) return { ok: false, error: 'job not found' };

  jobs[idx].status = newStatus;
  await setJobs(jobs);

  const config = await getTrelloConfig();
  if (config && jobs[idx].trelloCardId) {
    try {
      await trelloMoveCard(jobs[idx].trelloCardId, newStatus, config);
    } catch (e) {
      console.error('[JobClipper] Trello move failed:', e.message);
      return { ok: true, syncError: e.message };
    }
  }
  return { ok: true };
}

async function handleDeleteJob(url) {
  const jobs = await getJobs();
  const idx = jobs.findIndex(j => j.url === url);
  if (idx === -1) return { ok: false };

  const [job] = jobs.splice(idx, 1);
  await setJobs(jobs);

  const config = await getTrelloConfig();
  if (config && job.trelloCardId) {
    try {
      await trelloArchiveCard(job.trelloCardId, config);
    } catch (e) {
      console.error('[JobClipper] Trello archive failed:', e.message);
    }
  }
  return { ok: true };
}

async function handleClearAll() {
  const jobs = await getJobs();
  await setJobs([]);

  const config = await getTrelloConfig();
  if (config) {
    for (const job of jobs) {
      if (!job.trelloCardId) continue;
      await keepAlive();
      try {
        await trelloArchiveCard(job.trelloCardId, config);
      } catch (e) {
        console.error('[JobClipper] Trello archive failed:', e.message);
        if (e.message.includes('401')) break; // revoked token — every call will fail
      }
      await new Promise(r => setTimeout(r, 150)); // stay well under Trello rate limits
    }
  }
  return { ok: true, cleared: jobs.length };
}

// Merge a JSON export back in: keeps only well-formed entries, skips URLs we
// already have. Imported jobs do NOT auto-sync to Trello — that stays an
// explicit action (options page → Sync) so an import can't fire a burst of
// card creations by surprise.
async function handleImportJobs(incoming) {
  if (!Array.isArray(incoming)) return { ok: false, error: 'expected an array' };

  const jobs = await getJobs();
  const known = new Set(jobs.map(j => j.url));
  let added = 0, skipped = 0;

  for (const raw of incoming) {
    if (!raw || typeof raw.url !== 'string' || !isValidJobUrl(raw.url)) { skipped++; continue; }
    if (known.has(raw.url)) { skipped++; continue; }
    jobs.push({
      title: String(raw.title || '(untitled job)'),
      company: String(raw.company || ''),
      location: String(raw.location || ''),
      salary: String(raw.salary || ''),
      url: raw.url,
      source: String(raw.source || 'Other'),
      date: String(raw.date || ''),
      status: ['saved', 'applied', 'interview', 'offer', 'rejected'].includes(raw.status) ? raw.status : 'saved',
      ...(typeof raw.trelloCardId === 'string' ? { trelloCardId: raw.trelloCardId } : {})
    });
    known.add(raw.url);
    added++;
  }

  await setJobs(jobs);
  return { ok: true, added, skipped };
}

// ─── Trello connection (options page) ──────────────────────────────────────
async function handleTrelloState() {
  const [config, jobs] = await Promise.all([getTrelloConfig(), getJobs()]);
  return {
    ok: true,
    connected: !!config,
    boardUrl: config?.boardUrl || null,
    boardName: config?.boardName || null,
    username: config?.username || null,
    sharedKey: !!SHARED_TRELLO_KEY,
    unsyncedCount: jobs.filter(j => !j.trelloCardId).length,
    jobCount: jobs.length
  };
}

// Builds the Trello authorize URL. Lives here (not in options.js) because the
// baked-in SHARED_TRELLO_KEY is only readable from the service worker.
async function handleTrelloAuthUrl(key) {
  const k = (key || SHARED_TRELLO_KEY || '').trim();
  if (!k) return { ok: false, error: 'Missing API key' };
  const params = new URLSearchParams({
    expiration: 'never',
    name: 'Job Clipper',
    scope: 'read,write',
    response_type: 'token',
    key: k
  });
  return { ok: true, url: 'https://trello.com/1/authorize?' + params };
}

async function handleTrelloConnect(key, token) {
  const auth = {
    key: (key || SHARED_TRELLO_KEY || '').trim(),
    token: (token || '').trim()
  };
  if (!auth.key) return { ok: false, error: 'Missing API key' };
  if (!auth.token) return { ok: false, error: 'Missing token' };

  const username = await trelloValidate(auth); // throws with Trello's error on bad creds
  const { created, ...board } = await trelloFindOrCreateBoard(auth);

  const config = { ...auth, ...board, username };
  await chrome.storage.local.set({ trelloConfig: config });
  return { ok: true, username, boardUrl: board.boardUrl, boardCreated: created };
}

async function handleTrelloDisconnect() {
  // Keeps jobs and their trelloCardIds so reconnecting resumes cleanly;
  // the token itself is removed from storage.
  await chrome.storage.local.remove('trelloConfig');
  return { ok: true };
}

// Push local-only jobs up to the board. Sequential with a gap — a big backlog
// must not trip Trello's rate limits (300 req/10s per key, 100 per token).
async function handleTrelloSyncAll() {
  const config = await getTrelloConfig();
  if (!config) return { ok: false, error: 'not connected' };

  const jobs = await getJobs();
  const unsynced = jobs.filter(j => !j.trelloCardId);
  let synced = 0, adopted = 0;

  for (const job of [...unsynced].reverse()) { // oldest first
    await keepAlive();
    try {
      const existingId = await trelloFindCardByUrl(job.url, config);
      const cardId = existingId || await trelloCreateCard(job, config);
      if (existingId) {
        adopted++;
        // adopted card may sit in the wrong list — align it with local status
        if (job.status && job.status !== 'saved') {
          await trelloMoveCard(cardId, job.status, config).catch(() => {});
        }
      } else {
        synced++;
      }
      const fresh = await getJobs();
      const idx = fresh.findIndex(j => j.url === job.url);
      if (idx !== -1) {
        fresh[idx].trelloCardId = cardId;
        await setJobs(fresh);
      }
    } catch (e) {
      console.error('[JobClipper] sync failed for', job.url, e.message);
      if (e.message.includes('401')) break; // revoked token — every call will fail
    }
    await new Promise(r => setTimeout(r, 300)); // rate-limit gap on success AND failure
  }
  return { ok: true, synced, adopted, remaining: unsynced.length - synced - adopted };
}
