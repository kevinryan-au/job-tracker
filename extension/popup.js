// Set automatically during Claude setup — must match background.js
const WORKER_URL = 'YOUR_WORKER_URL';
// Set automatically during Claude setup — links the popup "Open board" button to your board
const TRELLO_BOARD_URL = 'YOUR_TRELLO_BOARD_URL';

// Send a request to the Cloudflare Worker
async function workerReq(body) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Worker ${res.status}`);
  return res.json();
}

// State
let allJobs = [];
let currentFilter = 'all';
let syncing = new Set();

const STATUS_OPTIONS = ['saved', 'applied', 'interview', 'offer', 'rejected'];
const STATUS_LABELS  = { saved: 'Saved', applied: 'Applied', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' };

// Storage
function load() {
  chrome.storage.local.get({ jobs: [] }, (data) => {
    allJobs = data.jobs;
    render();
    renderStats();
    renderHeader();
  });
}

function saveLocal() {
  chrome.storage.local.set({ jobs: allJobs }, () => {
    renderHeader();
    renderStats();
  });
}

// Sync indicator
function setSyncStatus(jobUrl, state) {
  const badge = document.querySelector(`.trello-status[data-url="${CSS.escape(jobUrl)}"]`);
  if (!badge) return;
  if (state === 'syncing') { badge.textContent = '↻'; badge.title = 'Syncing…'; badge.className = 'trello-status syncing'; }
  else if (state === 'synced') { badge.textContent = '✓'; badge.title = 'Synced to Trello'; badge.className = 'trello-status synced'; }
  else if (state === 'error') { badge.textContent = '!'; badge.title = 'Trello sync failed'; badge.className = 'trello-status error'; }
  else { badge.textContent = ''; badge.className = 'trello-status'; }
}

// Status changed in popup — update local storage + move Trello card via Worker
async function onStatusChanged(job) {
  if (!job.trelloCardId || syncing.has(job.url)) return;
  syncing.add(job.url);
  setSyncStatus(job.url, 'syncing');
  try {
    await workerReq({ action: 'move', cardId: job.trelloCardId, status: job.status });
    setSyncStatus(job.url, 'synced');
  } catch (e) {
    console.error('[JobClipper] move failed:', e.message);
    setSyncStatus(job.url, 'error');
  } finally {
    syncing.delete(job.url);
  }
}

// Job deleted in popup — archive Trello card via Worker
async function onJobDeleted(job) {
  if (!job.trelloCardId) return;
  try {
    await workerReq({ action: 'archive', cardId: job.trelloCardId });
  } catch (e) {
    console.error('[JobClipper] archive failed:', e.message);
  }
}

// Render
function renderHeader() {
  document.getElementById('hdr-total').textContent     = allJobs.length;
  document.getElementById('hdr-applied').textContent   = allJobs.filter(j => j.status === 'applied').length;
  document.getElementById('hdr-interview').textContent = allJobs.filter(j => j.status === 'interview').length;
}

function getFiltered() {
  if (currentFilter === 'all')      return allJobs;
  if (currentFilter === 'seek')     return allJobs.filter(j => j.source === 'Seek');
  if (currentFilter === 'linkedin') return allJobs.filter(j => j.source === 'LinkedIn');
  return allJobs.filter(j => j.status === currentFilter);
}

function render() {
  const list = document.getElementById('job-list');
  const jobs = getFiltered();

  if (!jobs.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">&#128269;</div>
        <div class="empty-title">${allJobs.length === 0 ? 'No jobs saved yet' : 'No jobs match this filter'}</div>
        <div class="empty-sub">${allJobs.length === 0 ? 'Browse Seek or LinkedIn and click<br>"+ Clip job" on any listing.' : 'Try a different filter.'}</div>
      </div>`;
    return;
  }

  list.innerHTML = jobs.map((job) => {
    const realIdx = allJobs.indexOf(job);
    const sourceClass = job.source === 'Seek' ? 'source-seek' : 'source-linkedin';
    const syncClass = job.trelloCardId ? 'synced' : '';
    const syncText  = job.trelloCardId ? '✓' : '';
    const syncTitle = job.trelloCardId ? 'Synced to Trello' : 'Not yet synced';
    const safeUrl = esc(job.url);
    return `
      <div class="job-item">
        <div class="job-row">
          <div>
            <div class="job-title">${esc(job.title)}</div>
            <div class="job-company">${esc(job.company)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <span class="trello-status ${syncClass}" data-url="${safeUrl}" title="${syncTitle}">${syncText}</span>
            <button class="del-btn" data-idx="${realIdx}" title="Remove">&#10005;</button>
          </div>
        </div>
        <div class="job-meta">
          <span class="source-badge ${sourceClass}">${job.source}</span>
          ${job.location ? `<span class="location">${esc(job.location)}</span>` : ''}
          ${job.salary   ? `<span class="location">· ${esc(job.salary)}</span>` : ''}
        </div>
        <div class="job-row" style="margin-top:4px;">
          <div style="display:flex;gap:8px;align-items:center;">
            <select class="status-select" data-idx="${realIdx}">
              ${STATUS_OPTIONS.map(s => `<option value="${s}" ${job.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
            </select>
            <a class="job-link" href="${safeUrl}" target="_blank">View &#8599;</a>
          </div>
          <span class="date">${job.date || ''}</span>
        </div>
      </div>`;
  }).join('');

  // Status change — update local + move Trello card via Worker
  list.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const idx = parseInt(e.target.dataset.idx);
      allJobs[idx].status = e.target.value;
      saveLocal();
      render();
      await onStatusChanged(allJobs[idx]);
    });
  });

  // Delete — remove locally + archive Trello card via Worker
  list.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const job = allJobs[idx];
      allJobs.splice(idx, 1);
      saveLocal();
      render();
      await onJobDeleted(job);
    });
  });
}

function renderStats() {
  const total  = allJobs.length;
  const synced = allJobs.filter(j => j.trelloCardId).length;
  const counts = { saved: 0, applied: 0, interview: 0, offer: 0, rejected: 0 };
  const sources = { Seek: 0, LinkedIn: 0 };
  allJobs.forEach(j => {
    if (counts[j.status] !== undefined) counts[j.status]++;
    if (sources[j.source] !== undefined) sources[j.source]++;
  });
  const responseRate = Math.round(
    ((counts.interview + counts.offer) / Math.max(counts.applied + counts.interview + counts.offer + counts.rejected, 1)) * 100
  );

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-card-num">${total}</div><div class="stat-card-label">Total saved</div></div>
    <div class="stat-card"><div class="stat-card-num">${counts.applied}</div><div class="stat-card-label">Applied</div></div>
    <div class="stat-card"><div class="stat-card-num">${counts.interview}</div><div class="stat-card-label">Interviews</div></div>
    <div class="stat-card"><div class="stat-card-num">${responseRate}%</div><div class="stat-card-label">Response rate</div></div>
  `;

  const seekPct   = total > 0 ? Math.round(sources.Seek / total * 100) : 0;
  const liPct     = total > 0 ? Math.round(sources.LinkedIn / total * 100) : 0;
  const syncedPct = total > 0 ? Math.round(synced / total * 100) : 0;

  document.getElementById('source-breakdown').innerHTML = `
    <div class="breakdown-title">Trello sync</div>
    <div class="breakdown-row"><span>Auto-synced</span><span>${synced} / ${total}</span></div>
    <div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:${syncedPct}%;background:#0052cc;"></div></div>
    <div class="breakdown-title" style="margin-top:12px;">By source</div>
    <div class="breakdown-row"><span>Seek</span><span>${sources.Seek} (${seekPct}%)</span></div>
    <div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:${seekPct}%;background:#f59e0b;"></div></div>
    <div class="breakdown-row"><span>LinkedIn</span><span>${sources.LinkedIn} (${liPct}%)</span></div>
    <div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:${liPct}%;"></div></div>
    <div class="breakdown-title" style="margin-top:12px;">By status</div>
    ${STATUS_OPTIONS.map(s => `<div class="breakdown-row"><span>${STATUS_LABELS[s]}</span><span>${counts[s]}</span></div>`).join('')}
  `;
}

function exportCSV() {
  const headers = ['Title', 'Company', 'Location', 'Salary', 'Status', 'Source', 'Date', 'URL', 'Trello Card'];
  const rows = allJobs.map(j => [
    j.title, j.company, j.location, j.salary, j.status, j.source, j.date, j.url,
    j.trelloCardId ? `https://trello.com/c/${j.trelloCardId}` : ''
  ].map(v => `"${(v || '').replace(/"/g, '""')}"`));
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `job-tracker-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Re-render when background.js saves a new job
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.jobs) return;
  allJobs = changes.jobs.newValue || [];
  render();
  renderStats();
  renderHeader();
});

// Wire up UI
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

document.getElementById('export-btn').addEventListener('click', exportCSV);

document.getElementById('trello-board-link').addEventListener('click', () => {
  chrome.tabs.create({ url: TRELLO_BOARD_URL || 'https://trello.com' });
});

document.getElementById('clear-btn').addEventListener('click', () => {
  if (confirm('Clear all saved jobs? Trello cards will be archived.')) {
    const toDelete = [...allJobs];
    allJobs = [];
    saveLocal();
    render();
    toDelete.forEach(j => onJobDeleted(j));
  }
});

load();
