// Job Clipper Pro v2.1 — Background service worker
// All Trello writes go through the Cloudflare Worker (credentials live there, not here).
// Local storage is the source of truth for the popup UI.

// Set automatically during Claude setup — replace with your deployed Worker URL
const WORKER_URL = 'YOUR_WORKER_URL';

// In-flight guard — prevents duplicate saves if two messages arrive before
// the first async storage write completes (e.g. rapid double-click)
const savingInFlight = new Set();

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SAVE_JOB') {
    handleSaveJob(msg.job).then(sendResponse).catch(err => {
      console.error('[JobClipper] SAVE_JOB error:', err);
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  if (msg.type === 'UPDATE_STATUS') {
    handleUpdateStatus(msg.url, msg.status).then(sendResponse).catch(err => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  if (msg.type === 'DELETE_JOB') {
    handleDeleteJob(msg.url).then(sendResponse).catch(err => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
});

async function handleSaveJob(job) {
  // Guard 1: in-memory — catches concurrent messages before storage is written
  if (savingInFlight.has(job.url)) return { ok: true, alreadySaved: true };
  savingInFlight.add(job.url);

  try {
    const data = await chrome.storage.local.get({ jobs: [] });
    const jobs = data.jobs;

    // Guard 2: storage — catches duplicates across service-worker restarts
    if (jobs.some(j => j.url === job.url)) return { ok: true, alreadySaved: true };

    job.status = 'saved';
    jobs.unshift(job);
    await chrome.storage.local.set({ jobs });

    // Guard 3: Worker — checks live Trello board before creating, catches
    // cross-system duplicates (e.g. same job already saved via iOS shortcut)
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', job })
      });
      const result = await res.json();
      if (result.alreadySaved) return { ok: true, alreadySaved: true };
      if (result.cardId) {
        jobs[0].trelloCardId = result.cardId;
        await chrome.storage.local.set({ jobs });
      }
    } catch (e) {
      console.error('[JobClipper] Worker save failed:', e.message);
      // Still return ok — saved locally even if Worker/Trello failed
    }

    return { ok: true, alreadySaved: false };
  } finally {
    savingInFlight.delete(job.url);
  }
}

async function handleUpdateStatus(url, newStatus) {
  const data = await chrome.storage.local.get({ jobs: [] });
  const jobs = data.jobs;
  const idx = jobs.findIndex(j => j.url === url);
  if (idx === -1) return { ok: false, error: 'job not found' };

  jobs[idx].status = newStatus;
  await chrome.storage.local.set({ jobs });

  if (jobs[idx].trelloCardId) {
    try {
      await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', cardId: jobs[idx].trelloCardId, status: newStatus })
      });
    } catch (e) {
      console.error('[JobClipper] Worker move failed:', e.message);
    }
  }
  return { ok: true };
}

async function handleDeleteJob(url) {
  const data = await chrome.storage.local.get({ jobs: [] });
  const jobs = data.jobs;
  const idx = jobs.findIndex(j => j.url === url);
  if (idx === -1) return { ok: false };

  const job = jobs[idx];
  jobs.splice(idx, 1);
  await chrome.storage.local.set({ jobs });

  if (job.trelloCardId) {
    try {
      await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive', cardId: job.trelloCardId })
      });
    } catch (e) {
      console.error('[JobClipper] Worker archive failed:', e.message);
    }
  }
  return { ok: true };
}
