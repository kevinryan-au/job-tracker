// Job Clipper — Cloudflare Worker
// Board and list IDs below are set automatically during Claude setup.
// Env vars required: TRELLO_KEY, TRELLO_TOKEN, ALLOWED_ORIGIN

const T = 'https://api.trello.com/1';

// Set automatically during Claude setup
const BOARD_ID = 'YOUR_BOARD_ID';
const L = {
  saved:     'YOUR_SAVED_LIST_ID',
  applied:   'YOUR_APPLIED_LIST_ID',
  interview: 'YOUR_INTERVIEW_LIST_ID',
  offer:     'YOUR_OFFER_LIST_ID',
  rejected:  'YOUR_REJECTED_LIST_ID'
};

export default {
  async fetch(r, e) {
    const o = e.ALLOWED_ORIGIN || '*';
    const c = {
      'Access-Control-Allow-Origin': o,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    const u = new URL(r.url);

    // GET /clip?url=... — one-shot scrape + save (used by iOS Shortcut)
    if (r.method === 'GET' && u.pathname === '/clip') {
      const jurl = u.searchParams.get('url');
      if (!jurl) return new Response('Missing url', { status: 400, headers: c });
      try {
        const k = e.TRELLO_KEY, t = e.TRELLO_TOKEN;
        if (!k || !t) return new Response('Not configured', { status: 500, headers: c });
        const d = await scrape(jurl);
        if (await isDuplicate(d.url, { k, t })) {
          return new Response('Already saved: ' + (d.title || 'job'), {
            status: 200, headers: { ...c, 'Content-Type': 'text/plain' }
          });
        }
        await tp('/cards', { k, t }, {
          name: (d.title || 'Untitled') + ' - ' + (d.company || ''),
          desc: [
            'Location: ' + (d.location || ''),
            'Salary: ' + (d.salary || ''),
            '',
            'Link: ' + d.url,
            'Saved: ' + new Date().toISOString().split('T')[0],
            'Source: ' + d.source
          ].filter(Boolean).join('\n'),
          idList: L.saved,
          urlSource: d.url
        });
        return new Response(
          'Saved to Trello: ' + (d.title || 'job') + ' at ' + (d.company || '?'),
          { status: 200, headers: { ...c, 'Content-Type': 'text/plain' } }
        );
      } catch (err) {
        return new Response('Error: ' + err.message, { status: 500, headers: c });
      }
    }

    if (r.method === 'OPTIONS') return new Response(null, { headers: c });
    if (r.method !== 'POST') return new Response('Job Clipper worker OK', { status: 200, headers: c });

    let b;
    try { b = await r.json(); }
    catch { return j({ error: 'bad json' }, 400, c); }

    const { action, job, cardId, status, url } = b;
    const k = e.TRELLO_KEY, t = e.TRELLO_TOKEN;

    try {
      if (action === 'scrape') {
        if (!url) return j({ error: 'no url' }, 400, c);
        return j({ ok: true, ...await scrape(url) }, 200, c);
      }
      if (!k || !t) return j({ error: 'not configured' }, 500, c);

      if (action === 'save') {
        if (!job?.url) return j({ error: 'no url' }, 400, c);
        if (await isDuplicate(job.url, { k, t })) {
          return j({ ok: true, alreadySaved: true }, 200, c);
        }
        const title = job.title || '(untitled job)';
        const d = [
          job.location ? 'Location: ' + job.location : '',
          job.salary   ? 'Salary: '   + job.salary   : '',
          '',
          job.url ? 'Link: ' + job.url : '',
          'Saved: '  + (job.date || new Date().toISOString().split('T')[0]),
          'Source: ' + (job.source || 'Mobile')
        ].filter(Boolean).join('\n');
        const card = await tp('/cards', { k, t }, {
          name: title + ' - ' + (job.company || ''),
          desc: d,
          idList: L[job.status] || L.saved,
          urlSource: job.url || undefined
        });
        return j({ ok: true, cardId: card.id, cardUrl: card.url }, 200, c);
      }

      if (action === 'move') {
        if (!cardId || !status) return j({ error: 'missing' }, 400, c);
        await tu('/cards/' + cardId, { k, t }, { idList: L[status] || L.saved });
        return j({ ok: true }, 200, c);
      }

      if (action === 'archive') {
        if (!cardId) return j({ error: 'missing' }, 400, c);
        await tu('/cards/' + cardId, { k, t }, { closed: true });
        return j({ ok: true }, 200, c);
      }

      return j({ error: 'unknown action' }, 400, c);
    } catch (err) {
      return j({ error: err.message }, 500, c);
    }
  }
};

// Check if a job URL is already on the board (open cards only).
// Fails open — if Trello is unreachable we allow the save rather than blocking it.
async function isDuplicate(canonicalUrl, auth) {
  if (!canonicalUrl) return false;
  try {
    const res = await fetch(
      `${T}/boards/${BOARD_ID}/cards?fields=desc&filter=open&key=${auth.k}&token=${auth.t}`
    );
    if (!res.ok) return false;
    const cards = await res.json();
    return cards.some(c => c.desc && c.desc.includes(canonicalUrl));
  } catch {
    return false;
  }
}

async function scrape(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/html',
      'Accept-Language': 'en-AU'
    }
  });
  const h = await res.text();

  const og = n => {
    const m = h.match(new RegExp('<meta[^>]+property=["\']og:' + n + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'))
           || h.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:' + n + '["\']', 'i'));
    return m ? m[1].trim() : '';
  };
  const tt = (h.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';

  let title = og('title') || tt;
  let company = '', location = '', salary = '';

  const jld = h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (jld) {
    try {
      const d = JSON.parse(jld[1]);
      title = title || d.title || '';
      company = d.hiringOrganization?.name || '';
      const a = d.jobLocation?.address;
      location = a ? [a.addressLocality, a.addressRegion].filter(Boolean).join(', ') : '';
      const sv = d.baseSalary?.value;
      if (sv?.minValue) salary = '$' + sv.minValue + (sv.maxValue ? '-$' + sv.maxValue : '');
    } catch (e) {}
  }

  if (url.includes('linkedin.com') && !company) {
    const m = title.match(/^(.+?)\s+at\s+(.+?)\s*[|\-]/);
    if (m) { title = m[1].trim(); company = m[2].trim(); }
    else title = title.replace(/\s*[|\-].*$/, '').trim();
  }
  if (url.includes('seek.com')) title = title.replace(/\s*[|\-].*$/, '').trim();

  const source = url.includes('linkedin.com') ? 'LinkedIn'
               : url.includes('seek.com')     ? 'Seek'
               : 'Other';

  // Canonical URL — must match what the Chrome extension saves so dedup works
  // across both mobile and desktop saves of the same job.
  let cu;
  if (url.includes('linkedin.com')) {
    const id = (url.match(/\/jobs\/view\/(\d+)/) || [])[1]
            || new URL(url).searchParams.get('currentJobId');
    cu = id ? `https://www.linkedin.com/jobs/view/${id}/` : url.split('?')[0];
  } else if (url.includes('seek.com')) {
    const id = (url.match(/\/job\/(\d+)/) || [])[1]
            || new URL(url).searchParams.get('jobId');
    cu = id ? `https://www.seek.com.au/job/${id}` : url.split('?')[0];
  } else {
    cu = url.split('?')[0];
  }

  return { title, company, location, salary, source, url: cu };
}

async function tp(p, a, b) {
  const r = await fetch(T + p + '?key=' + a.k + '&token=' + a.t, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b)
  });
  if (!r.ok) throw new Error('Trello ' + r.status);
  return r.json();
}

async function tu(p, a, b) {
  const r = await fetch(T + p + '?key=' + a.k + '&token=' + a.t, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b)
  });
  if (!r.ok) throw new Error('Trello ' + r.status);
  return r.json();
}

function j(d, s = 200, h = {}) {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { 'Content-Type': 'application/json', ...h }
  });
}
