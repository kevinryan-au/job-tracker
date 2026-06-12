// Job Tracker — options page
// Pure UI: all Trello work happens in background.js via messages.

const $ = (id) => document.getElementById(id);

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function showMsg(text, type) {
  const el = $('msg');
  el.textContent = text;
  el.className = 'msg ' + type;
}

function clearMsg() {
  $('msg').className = 'msg';
}

async function render() {
  const state = await send({ type: 'TRELLO_STATE' });

  if (state.connected) {
    $('view-setup').style.display = 'none';
    $('view-connected').style.display = 'block';
    $('conn-user').textContent = '@' + state.username;
    $('conn-board').textContent = state.boardName;
    $('conn-board').href = state.boardUrl;

    const syncBtn = $('sync-btn');
    if (state.unsyncedCount > 0) {
      syncBtn.style.display = 'inline-block';
      syncBtn.textContent = `Sync ${state.unsyncedCount} local job${state.unsyncedCount === 1 ? '' : 's'} to Trello`;
    } else {
      syncBtn.style.display = 'none';
    }
  } else {
    $('view-setup').style.display = 'block';
    $('view-connected').style.display = 'none';
    if (state.sharedKey) {
      $('key-block').style.display = 'none';
      $('key-baked').style.display = 'block';
    }
  }
}

$('authorize-btn').addEventListener('click', async () => {
  // background owns the (possibly baked-in) API key, so it builds the URL
  const res = await send({ type: 'TRELLO_AUTH_URL', key: $('key-input').value.trim() || null });
  if (!res.ok) {
    showMsg('Paste your API key first (step 1) — the token link is built from it.', 'error');
    return;
  }
  clearMsg();
  window.open(res.url, '_blank');
});

$('connect-btn').addEventListener('click', async () => {
  const btn = $('connect-btn');
  const key = $('key-input').value.trim() || null;
  const token = $('token-input').value.trim();

  const state = await send({ type: 'TRELLO_STATE' }).catch(() => ({}));
  if (!key && !state.sharedKey) {
    showMsg(humanError('missing api key'), 'error');
    return;
  }
  if (!token) {
    showMsg('Paste your token first — click "Get my token", approve, and copy the string Trello shows you.', 'error');
    return;
  }
  clearMsg();
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    const res = await send({ type: 'TRELLO_CONNECT', key, token });
    if (res.ok) {
      showMsg(
        res.boardCreated
          ? `Connected as @${res.username} — created your "Job Hunt" board.`
          : `Connected as @${res.username} — found your existing "Job Hunt" board and reused it.`,
        'success'
      );
      await render();
    } else {
      showMsg(humanError(res.error), 'error');
    }
  } catch (e) {
    showMsg(humanError(e.message), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect & create my board';
  }
});

$('sync-btn').addEventListener('click', async () => {
  const btn = $('sync-btn');
  btn.disabled = true;
  btn.textContent = 'Syncing… (this can take a moment)';
  try {
    const res = await send({ type: 'TRELLO_SYNC_ALL' });
    if (res.ok) {
      showMsg(`Done — ${res.synced} card${res.synced === 1 ? '' : 's'} created` +
        (res.adopted ? `, ${res.adopted} matched to existing cards` : '') +
        (res.remaining > 0 ? `, ${res.remaining} failed (try again)` : '') + '.',
        res.remaining > 0 ? 'error' : 'success');
    } else {
      showMsg(humanError(res.error), 'error');
    }
  } catch (e) {
    showMsg(humanError(e.message), 'error');
  } finally {
    btn.disabled = false;
  }
  await render();
});

$('disconnect-btn').addEventListener('click', async () => {
  if (!confirm('Disconnect Trello? Your jobs stay in the local tracker; the token is removed from this browser.')) return;
  await send({ type: 'TRELLO_DISCONNECT' });
  clearMsg();
  await render();
});

function humanError(error) {
  const e = (error || '').toLowerCase();
  // "invalid key" arrives as "Trello 401: invalid key" — check it before the
  // generic 401 branch or users get told to fix the wrong credential
  if (e.includes('invalid key')) {
    return 'Trello rejected the API key. Check step 1 — it should be a 32-character string from trello.com/power-ups/admin.';
  }
  if (e.includes('missing api key')) {
    return 'Paste your API key first (step 1) — see "How do I get an API key?" below it.';
  }
  if (e.includes('401') || e.includes('invalid token') || e.includes('unauthorized')) {
    return 'Trello rejected that token. Re-copy it carefully (no spaces), or generate a fresh one with "Get my token".';
  }
  if (e.includes('failed to fetch')) {
    return 'Could not reach Trello — check your internet connection and try again.';
  }
  return 'Something went wrong: ' + error;
}

render();
