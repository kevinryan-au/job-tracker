// Job Tracker — Trello API client
// Loaded into the background service worker via importScripts('trello.js').
// All Trello traffic in the extension goes through these functions; popup and
// options pages reach them by messaging background.js, so this is the single
// place the token is ever read.
//
// Auth model: Trello API keys are public identifiers (the token is the secret).
// If you fork this and want users to skip creating their own key, generate one
// at https://trello.com/power-ups/admin and paste it below — the options page
// then only asks for a token.

const SHARED_TRELLO_KEY = ''; // optional: bake in a public API key for your users

const TRELLO_API = 'https://api.trello.com/1';

const TRELLO_LIST_NAMES = {
  saved: 'Saved',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected'
};

// All params go in the query string — Trello accepts this for every verb,
// and it keeps requests "simple" (no preflight) regardless of context.
async function trelloFetch(auth, method, path, params = {}) {
  const qs = new URLSearchParams({ ...params, key: auth.key, token: auth.token });
  const res = await fetch(`${TRELLO_API}${path}?${qs}`, { method });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Trello ${res.status}${body ? ': ' + body.slice(0, 120) : ''}`);
  }
  return res.json();
}

// Returns the Trello username if the key+token pair works, else throws.
async function trelloValidate(auth) {
  const me = await trelloFetch(auth, 'GET', '/members/me', { fields: 'username' });
  return me.username;
}

// Finds an open board by name or creates it, then ensures the five pipeline
// lists exist (reusing any whose names already match, case-insensitively).
// Idempotent: safe to run again after a partial failure.
async function trelloFindOrCreateBoard(auth, boardName = 'Job Hunt') {
  const boards = await trelloFetch(auth, 'GET', '/members/me/boards', {
    fields: 'name,url', filter: 'open'
  });
  let board = boards.find(b => b.name === boardName);
  let created = false;
  if (!board) {
    board = await trelloFetch(auth, 'POST', '/boards/', {
      name: boardName, defaultLists: 'false'
    });
    created = true;
  }

  const existing = await trelloFetch(auth, 'GET', `/boards/${board.id}/lists`, {
    fields: 'name', filter: 'open'
  });
  const lists = {};
  for (const [status, listName] of Object.entries(TRELLO_LIST_NAMES)) {
    const match = existing.find(l => l.name.toLowerCase() === listName.toLowerCase());
    lists[status] = match
      ? match.id
      : (await trelloFetch(auth, 'POST', '/lists', {
          name: listName, idBoard: board.id, pos: 'bottom'
        })).id;
  }

  return { boardId: board.id, boardUrl: board.url, boardName, lists, created };
}

// Board-level dedup: returns the id of an open card whose description contains
// the job's canonical URL, or null. Matches the full "Link: <url>" line (the
// "Saved:" line always follows, so "\n" terminates it) — a bare substring
// match would let job id 1234 wrongly adopt the card for job 12345.
// trelloCreateCard and mobile/worker.js write this line; keep all three in sync.
async function trelloFindCardByUrl(url, config) {
  if (!url) return null;
  const cards = await trelloFetch(config, 'GET', `/boards/${config.boardId}/cards`, {
    fields: 'desc', filter: 'open'
  });
  const hit = cards.find(c => c.desc && c.desc.includes(`Link: ${url}\n`));
  return hit ? hit.id : null;
}

async function trelloCreateCard(job, config) {
  const desc = [
    job.location ? `Location: ${job.location}` : '',
    job.salary ? `Salary: ${job.salary}` : '',
    `Link: ${job.url}`,
    `Saved: ${job.date || new Date().toISOString().split('T')[0]}`,
    `Source: ${job.source || 'Other'}`
  ].filter(Boolean).join('\n');

  const card = await trelloFetch(config, 'POST', '/cards', {
    name: `${job.title || '(untitled job)'} — ${job.company || ''}`,
    desc,
    idList: config.lists[job.status] || config.lists.saved,
    urlSource: job.url
  });
  return card.id;
}

async function trelloMoveCard(cardId, status, config) {
  await trelloFetch(config, 'PUT', `/cards/${cardId}`, {
    idList: config.lists[status] || config.lists.saved
  });
}

async function trelloArchiveCard(cardId, config) {
  await trelloFetch(config, 'PUT', `/cards/${cardId}`, { closed: 'true' });
}
