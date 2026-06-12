// Job Tracker v3.0 — LinkedIn content script
window.__jobTrackerVersion = '3.0';

(function () {
  'use strict';

  const FLOAT_ID = 'jt-float-v19';
  const TOAST_ID = 'jt-toast-v19';

  function getJobId() {
    const pathMatch = window.location.pathname.match(/\/jobs\/view\/(\d+)/);
    if (pathMatch) return pathMatch[1];
    return new URLSearchParams(window.location.search).get('currentJobId');
  }

  function isJobContext() { return !!getJobId(); }

  function extractJob() {
    const jobId = getJobId();

    // LinkedIn ships randomly-hashed CSS class names that change every deploy,
    // and the logged-in SPA has no <h1> and no JSON-LD. The only stable signals
    // are the document title and the /company/ href, so anchor on those.

    // TITLE + COMPANY from document.title: "<title> | <company> | LinkedIn"
    // (strip a leading "(N) " unread-message badge LinkedIn sometimes prepends)
    let title = '', company = '';
    const dt = document.title.replace(/^\(\d+\)\s*/, '');
    const parts = dt.split(' | ');
    if (parts.length >= 3) {
      title = parts[0].trim();
      company = parts[1].trim();
    } else if (parts.length === 2) {
      title = parts[0].trim();
    }

    // COMPANY: the /company/ URL path is stable across redesigns — prefer it
    const companyAnchor = document.querySelector('a[href*="/company/"]');
    const caTxt = companyAnchor?.innerText?.trim();
    if (caTxt && caTxt.length > 1 && caTxt.length < 80) company = caTxt;

    // LOCATION: scan the top-card container (climb from the company anchor) for
    // a comma-formatted "City, Region, Country" leaf, excluding metadata noise
    let location = '';
    if (companyAnchor) {
      let box = companyAnchor;
      for (let i = 0; i < 6; i++) box = box.parentElement || box;
      const noise = /\b(ago|applicant|people|clicked|apply|promoted|response|managed|full-time|part-time|contract|hybrid|remote|on-site|saved|easy)\b/i;
      const cand = [...box.querySelectorAll('span,div,a,li,p')]
        .filter(el => el.children.length === 0)
        .map(el => el.innerText && el.innerText.trim())
        .filter(t => t && t.includes(',') && t.length < 70 &&
          t !== title && t !== company && !noise.test(t));
      location = cand[0] || '';
    }

    const salary = [...document.querySelectorAll('span,p,li')]
      .find(el => el.children.length === 0 && /\$[\d,]+/.test(el.innerText) &&
        el.innerText.trim().length < 80)?.innerText?.trim() || '';

    return {
      title, company, location, salary,
      url: jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : window.location.href,
      source: 'LinkedIn',
      date: new Date().toISOString().split('T')[0],
    };
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

  function enableButton() {
    const btn = document.querySelector(`#${FLOAT_ID} button`);
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }
  }

  function handleSave() {
    const job = extractJob();
    const partialSave = !job.title;
    if (partialSave) job.title = '(untitled job)';

    // Send to background script via chrome.runtime.sendMessage
    // Background script handles storage + Trello so we avoid isolated world issues
    chrome.runtime.sendMessage({ type: 'SAVE_JOB', job }, (response) => {
      if (chrome.runtime.lastError) {
        showToast('Extension error — try reloading.', 'error');
        enableButton();
        return;
      }
      if (response?.alreadySaved) {
        showToast('Already saved!', 'warn');
        enableButton();
      } else if (response?.ok) {
        showToast(partialSave ? 'Saved (URL only) — details not extracted' : `Saved: ${job.title}`,
          partialSave ? 'warn' : 'success');
        const btn = document.querySelector(`#${FLOAT_ID} button`);
        if (btn) {
          btn.innerText = '✓ Saved';
          btn.style.background = '#15803d';
          setTimeout(() => {
            btn.innerText = '+ Track job';
            btn.style.background = '#1d4ed8';
            enableButton();
          }, 2500);
        }
      } else {
        showToast('Save failed — check extension.', 'error');
        enableButton();
      }
    });
  }

  function rebuildButton() {
    // Remove all old versions
    ['job-tracker-float', 'jt-float-v18', 'jt-float-v19'].forEach(id =>
      document.getElementById(id)?.remove()
    );

    if (!isJobContext()) return;

    const wrap = document.createElement('div');
    wrap.id = FLOAT_ID;
    wrap.setAttribute('data-version', '3.0');
    wrap.style.cssText = 'position:fixed;bottom:140px;right:20px;z-index:2147483646;';

    const btn = document.createElement('button');
    btn.innerText = '+ Track job';
    btn.style.cssText = `padding:10px 20px;background:#1d4ed8;color:#fff;font-size:14px;
      font-weight:600;border:none;border-radius:24px;cursor:pointer;font-family:inherit;
      box-shadow:0 2px 12px rgba(29,78,216,.45);`;
    btn.onmouseover = () => { btn.style.background = '#1e40af'; };
    btn.onmouseout  = () => { btn.style.background = '#1d4ed8'; };
    btn.onclick = (e) => {
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
