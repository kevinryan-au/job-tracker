// Job Tracker — popup tracker UI
// Pure view: reads jobs from chrome.storage.local, but every mutation goes
// through background.js via messages (single-writer model). The popup
// re-renders off storage.onChanged, so background writes flow back here.

const $ = (id) => document.getElementById(id);

let allJobs = [];
let currentFilter = 'all';
let trello = { connected: false, boardUrl: null };

const STATUS_OPTIONS = ['saved', 'applied', 'interview', 'offer', 'rejected'];
const STATUS_LABELS = { saved: 'Saved', applied: 'Applied', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' };

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

async function load() {
  const [data, state] = await Promise.all([
    chrome.storage.local.get({ jobs: [] }),
    send({ type: 'TRELLO_STATE' })
  ]);
  allJobs = data.jobs;
  trello = state;
  renderAll();
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.jobs) {
    allJobs = changes.jobs.newValue || [];
    renderAll();
  }
  if (changes.trelloConfig) {
    send({ type: 'TRELLO_STATE' }).then(state => { trello = state; renderAll(); });
  }
});

// ─── Render ────────────────────────────────────────────────────────────────
function renderAll() {
  render();
  renderStats();
  renderHeader();
}

function renderHeader() {
  $('hdr-total').textContent = allJobs.length;
  $('hdr-applied').textContent = allJobs.filter(j => j.status === 'applied').length;
  $('hdr-interview').textContent = allJobs.filter(j => j.status === 'interview').length;

  const badge = $('trello-board-link');
  badge.innerHTML = trello.connected ? '&#9654; Trello board' : 'Connect Trello';
}

function getFiltered() {
  if (currentFilter === 'all') return allJobs;
  if (currentFilter === 'seek') return allJobs.filter(j => j.source === 'Seek');
  if (currentFilter === 'linkedin') return allJobs.filter(j => j.source === 'LinkedIn');
  return allJobs.filter(j => j.status === currentFilter);
}

function render() {
  const list = $('job-list');
  const jobs = getFiltered();

  if (!jobs.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">&#128269;</div>
        <div class="empty-title">${allJobs.length === 0 ? 'No jobs saved yet' : 'No jobs match this filter'}</div>
        <div class="empty-sub">${allJobs.length === 0 ? 'Browse Seek or LinkedIn and click<br>"+ Track job" on any listing.' : 'Try a different filter.'}</div>
      </div>`;
    return;
  }

  list.innerHTML = jobs.map((job) => {
    const realIdx = allJobs.indexOf(job);
    const sourceClass = job.source === 'Seek' ? 'source-seek' : 'source-linkedin';
    const syncClass = job.trelloCardId ? 'synced' : (trello.connected ? 'unsynced' : '');
    const syncText = job.trelloCardId ? '✓' : (trello.connected ? '○' : '');
    const syncTitle = job.trelloCardId ? 'Synced to Trello'
      : (trello.connected ? 'Not yet synced — see Settings' : 'Local only');
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
          <span class="source-badge ${sourceClass}">${esc(job.source)}</span>
          ${job.location ? `<span class="location">${esc(job.location)}</span>` : ''}
          ${job.salary ? `<span class="location">· ${esc(job.salary)}</span>` : ''}
        </div>
        <div class="job-row" style="margin-top:4px;">
          <div style="display:flex;gap:8px;align-items:center;">
            <select class="status-select" data-idx="${realIdx}">
              ${STATUS_OPTIONS.map(s => `<option value="${s}" ${job.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
            </select>
            <a class="job-link" href="${safeUrl}" target="_blank">View &#8599;</a>
          </div>
          <span class="date">${esc(job.date || '')}</span>
        </div>
      </div>`;
  }).join('');

  // Mutations are optimistic locally, then sent to background — the storage
  // write it makes triggers onChanged, which re-renders with the truth.
  list.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const job = allJobs[idx];
      job.status = e.target.value;
      renderAll();
      send({ type: 'UPDATE_STATUS', url: job.url, status: job.status });
    });
  });

  list.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const job = allJobs[idx];
      allJobs.splice(idx, 1);
      renderAll();
      send({ type: 'DELETE_JOB', url: job.url });
    });
  });
}

function renderStats() {
  const total = allJobs.length;
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

  $('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-card-num">${total}</div><div class="stat-card-label">Total saved</div></div>
    <div class="stat-card"><div class="stat-card-num">${counts.applied}</div><div class="stat-card-label">Applied</div></div>
    <div class="stat-card"><div class="stat-card-num">${counts.interview}</div><div class="stat-card-label">Interviews</div></div>
    <div class="stat-card"><div class="stat-card-num">${responseRate}%</div><div class="stat-card-label">Response rate</div></div>
  `;

  const seekPct = total > 0 ? Math.round(sources.Seek / total * 100) : 0;
  const liPct = total > 0 ? Math.round(sources.LinkedIn / total * 100) : 0;
  const syncedPct = total > 0 ? Math.round(synced / total * 100) : 0;

  $('source-breakdown').innerHTML = `
    ${trello.connected ? `
      <div class="breakdown-title">Trello sync</div>
      <div class="breakdown-row"><span>Synced</span><span>${synced} / ${total}</span></div>
      <div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:${syncedPct}%;background:#0052cc;"></div></div>
    ` : ''}
    <div class="breakdown-title" style="margin-top:12px;">By source</div>
    <div class="breakdown-row"><span>Seek</span><span>${sources.Seek} (${seekPct}%)</span></div>
    <div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:${seekPct}%;background:#f59e0b;"></div></div>
    <div class="breakdown-row"><span>LinkedIn</span><span>${sources.LinkedIn} (${liPct}%)</span></div>
    <div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:${liPct}%;"></div></div>
    <div class="breakdown-title" style="margin-top:12px;">By status</div>
    ${STATUS_OPTIONS.map(s => `<div class="breakdown-row"><span>${STATUS_LABELS[s]}</span><span>${counts[s]}</span></div>`).join('')}
  `;
}

// ─── Export / import ───────────────────────────────────────────────────────
function downloadBlob(content, mime, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
}

function exportCSV() {
  const headers = ['Title', 'Company', 'Location', 'Salary', 'Status', 'Source', 'Date', 'URL', 'Trello Card'];
  const rows = allJobs.map(j => [
    j.title, j.company, j.location, j.salary, j.status, j.source, j.date, j.url,
    j.trelloCardId ? `https://trello.com/c/${j.trelloCardId}` : ''
  ].map(v => {
    // scraped text can start with =/+/-/@ — neutralize so spreadsheets don't
    // execute it as a formula (CSV injection)
    const safe = /^[=+\-@]/.test(v || '') ? `'${v}` : (v || '');
    return `"${safe.replace(/"/g, '""')}"`;
  }));
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  downloadBlob(csv, 'text/csv', `job-tracker-${new Date().toISOString().split('T')[0]}.csv`);
}

function exportJSON() {
  downloadBlob(JSON.stringify(allJobs, null, 2), 'application/json',
    `job-tracker-${new Date().toISOString().split('T')[0]}.json`);
}

async function importJSON(file) {
  try {
    const jobs = JSON.parse(await file.text());
    if (!Array.isArray(jobs)) throw new Error('expected a JSON array of jobs');
    const res = await send({ type: 'IMPORT_JOBS', jobs });
    alert(res.ok ? `Imported ${res.added} job${res.added === 1 ? '' : 's'} (${res.skipped} already saved).`
                 : 'Import failed: ' + res.error);
  } catch (e) {
    alert('Could not import that file: ' + e.message);
  }
}

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Wire up UI ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $('panel-' + tab.dataset.tab).classList.add('active');
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

$('export-btn').addEventListener('click', exportCSV);
$('export-json-btn').addEventListener('click', exportJSON);
$('import-btn').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', (e) => {
  if (e.target.files[0]) importJSON(e.target.files[0]);
  e.target.value = '';
});

$('trello-board-link').addEventListener('click', () => {
  if (trello.connected && trello.boardUrl) {
    chrome.tabs.create({ url: trello.boardUrl });
  } else {
    chrome.runtime.openOptionsPage();
  }
});

$('settings-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());

$('clear-btn').addEventListener('click', () => {
  const note = trello.connected ? ' Their Trello cards will be archived.' : '';
  if (confirm(`Clear all saved jobs?${note}`)) {
    allJobs = [];
    renderAll();
    send({ type: 'CLEAR_ALL' });
  }
});

load();
