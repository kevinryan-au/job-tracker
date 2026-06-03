// Job Clipper Pro v2.0 — Seek content script
// Handles both single job page (/job/12345) and multi-pane search (/jobs?...)

(function () {
  'use strict';

  const FLOAT_ID = 'jcp-float-seek-v20';
  const TOAST_ID = 'jcp-toast-seek-v20';

  function getJobId() {
    // Single job page: seek.com.au/job/12345678
    const pathMatch = window.location.pathname.match(/\/job\/(\d+)/);
    if (pathMatch) return pathMatch[1];
    // Multi-pane: jobId appears as query param e.g. ?jobId=12345678
    return new URLSearchParams(window.location.search).get('jobId');
  }

  function isJobContext() {
    return !!getJobId();
  }

  function extractJob() {
    const jobId = getJobId();

    // Title — works in both layouts
    const title =
      document.querySelector('[data-automation="job-detail-title"]')?.innerText?.trim() ||
      document.querySelector('h1[data-automation]')?.innerText?.trim() ||
      document.querySelector('h1')?.innerText?.trim() || '';

    // Company
    const company =
      document.querySelector('[data-automation="advertiser-name"]')?.innerText?.trim() ||
      document.querySelector('[data-automation="job-detail-header"] a')?.innerText?.trim() ||
      document.querySelector('a[data-automation="job-header-company-name"]')?.innerText?.trim() || '';

    // Location
    const location =
      document.querySelector('[data-automation="job-detail-location"]')?.innerText?.trim() ||
      document.querySelector('[data-automation="job-detail-work-type-location"]')?.innerText?.trim() ||
      document.querySelector('[data-automation="job-detail-classifications"]')?.innerText?.trim() || '';

    // Salary
    const salary =
      document.querySelector('[data-automation="job-detail-salary"]')?.innerText?.trim() || '';

    // Canonical URL — always use the /job/ID form
    const url = jobId
      ? `https://www.seek.com.au/job/${jobId}`
      : window.location.href.split('?')[0];

    return { title, company, location, salary, url, source: 'Seek', date: new Date().toISOString().split('T')[0] };
  }

  function showToast(msg, type = 'success') {
    document.getElementById(TOAST_ID)?.remove();
    const colors = { success: '#15803d', error: '#b91c1c', warn: '#92400e' };
    const t = document.createElement('div');
    t.id = TOAST_ID;
    t.style.cssText = `position:fixed;bottom:200px;right:20px;background:${colors[type]};
      color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:500;
      font-family:inherit;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.25);`;
    t.innerText = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function handleSave() {
    const job = extractJob();
    const partialSave = !job.title;
    if (partialSave) job.title = '(untitled job)';

    chrome.runtime.sendMessage({ type: 'SAVE_JOB', job }, (response) => {
      if (chrome.runtime.lastError) {
        showToast('Extension error — try reloading.', 'error');
        return;
      }
      if (response?.alreadySaved) {
        showToast('Already saved!', 'warn');
      } else if (response?.ok) {
        showToast(partialSave ? 'Saved (URL only) — details not extracted' : `Saved: ${job.title}`,
          partialSave ? 'warn' : 'success');
        const btn = document.querySelector(`#${FLOAT_ID} button`);
        if (btn) {
          btn.innerText = '✓ Saved';
          btn.style.background = '#15803d';
          setTimeout(() => { btn.innerText = '+ Clip job'; btn.style.background = '#1d4ed8'; }, 2500);
        }
      } else {
        showToast('Save failed — check extension.', 'error');
      }
    });
  }

  function rebuildButton() {
    ['job-clipper-float', 'jcp-float-seek-v19', 'jcp-float-seek-v20'].forEach(id =>
      document.getElementById(id)?.remove()
    );

    if (!isJobContext()) return;

    const wrap = document.createElement('div');
    wrap.id = FLOAT_ID;
    wrap.setAttribute('data-version', '2.0');
    wrap.style.cssText = 'position:fixed;bottom:140px;right:20px;z-index:2147483646;';

    const btn = document.createElement('button');
    btn.innerText = '+ Clip job';
    btn.style.cssText = `padding:10px 20px;background:#1d4ed8;color:#fff;font-size:14px;
      font-weight:600;border:none;border-radius:24px;cursor:pointer;font-family:inherit;
      box-shadow:0 2px 12px rgba(29,78,216,.45);`;
    btn.onmouseover = () => { btn.style.background = '#1e40af'; };
    btn.onmouseout  = () => { btn.style.background = '#1d4ed8'; };
    btn.onclick = () => {
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.style.cursor = 'default';
      handleSave();
    };

    wrap.appendChild(btn);
    document.body.appendChild(wrap);
  }

  rebuildButton();

  let lastJobId = getJobId();
  new MutationObserver(() => {
    const jobId = getJobId();
    if (jobId !== lastJobId) {
      lastJobId = jobId;
      rebuildButton();
    } else if (!document.getElementById(FLOAT_ID) && isJobContext()) {
      rebuildButton();
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
