// Job Tracker — optional mobile add-on (Cloudflare Worker)
//
// Gives your PHONE a way to save: an iOS Shortcut shares a job URL to
// GET /track?s=<secret>&url=..., this Worker fetches the page server-side,
// extracts the job details, and files a card into the "Saved" list of your
// board — with the same URL-based dedup the extension uses, so saving on
// the phone and again at the desk doesn't double up.
//
// The desktop extension does NOT use this. Deploy it only if you want mobile
// saving. Setup: see mobile/README.md (or let Claude Code walk you through
// it — CLAUDE.md has the playbook).
//
// Secrets (set via `wrangler secret put`):
//   TRELLO_KEY, TRELLO_TOKEN — your Trello credentials
//   TRACK_SECRET — any passphrase you invent; gates the endpoint so only your
//                 Shortcut can create cards or make this Worker fetch URLs
// Constants (edit below): BOARD_ID, SAVED_LIST_ID

const BOARD_ID = 'YOUR_BOARD_ID';           // dedup checks this board
const SAVED_LIST_ID = 'YOUR_SAVED_LIST_ID'; // new saves land in this list

const T = 'https://api.trello.com/1';

const TEXT = {
  'content-type': 'text/plain; charset=utf-8',
  'x-content-type-options': 'nosniff'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/track') {
      return new Response('OK', { status: 200, headers: TEXT });
    }

    // The endpoint mutates your Trello board and fetches arbitrary URLs
    // server-side — without this gate, anyone who learns the Worker URL
    // could spam your board or use it as an open fetch proxy.
    if (!env.TRACK_SECRET) {
      return new Response('Not configured: set the TRACK_SECRET secret', { status: 500, headers: TEXT });
    }
    if (url.searchParams.get('s') !== env.TRACK_SECRET) {
      return new Response('Forbidden', { status: 403, headers: TEXT });
    }

    // Take everything after "url=" verbatim rather than trusting searchParams:
    // job URLs contain "&" (e.g. ?origin=X&currentJobId=123), and a Shortcut
    // that forgot to URL-encode would otherwise silently lose the job id —
    // which breaks cross-device dedup. Requires url= to be the LAST param.
    const rawIdx = request.url.indexOf('url=');
    if (rawIdx === -1) return new Response('Missing url', { status: 400, headers: TEXT });
    let jobUrl = request.url.slice(rawIdx + 4);
    try { jobUrl = decodeURIComponent(jobUrl); } catch { /* already decoded */ }
    if (!/^https?:\/\//.test(jobUrl)) return new Response('Bad url', { status: 400, headers: TEXT });

    const auth = { key: env.TRELLO_KEY, token: env.TRELLO_TOKEN };
    if (!auth.key || !auth.token) {
      return new Response('Not configured: set TRELLO_KEY and TRELLO_TOKEN secrets', { status: 500, headers: TEXT });
    }

    try {
      const job = await scrape(jobUrl);

      if (await isDuplicate(job.url, auth)) {
        return new Response(`Already saved: ${job.title || 'job'}`, { status: 200, headers: TEXT });
      }

      await createCard(job, auth);
      return new Response(`Saved to Trello: ${job.title || 'job'} at ${job.company || '?'}`, { status: 200, headers: TEXT });
    } catch (err) {
      return new Response('Error: ' + err.message, { status: 500, headers: TEXT });
    }
  }
};

// URL-based dedup against open cards on the board. Matches the full
// "Link: <url>" desc line (terminated by \n — the "Saved:" line always
// follows) so a short job id can't wrongly match a longer one. The extension's
// trello.js writes and matches the same line; keep all three in sync.
async function isDuplicate(canonicalUrl, auth) {
  if (!canonicalUrl) return false;
  try {
    const res = await fetch(
      `${T}/boards/${BOARD_ID}/cards?fields=desc&filter=open&key=${auth.key}&token=${auth.token}`
    );
    if (!res.ok) return false;
    const cards = await res.json();
    return cards.some(c => c.desc && c.desc.includes(`Link: ${canonicalUrl}\n`));
  } catch {
    return false; // fail open — better a rare duplicate than a lost save
  }
}

async function createCard(job, auth) {
  const desc = [
    job.location ? `Location: ${job.location}` : '',
    job.salary ? `Salary: ${job.salary}` : '',
    `Link: ${job.url}`,
    `Saved: ${new Date().toISOString().split('T')[0]}`,
    `Source: ${job.source}`
  ].filter(Boolean).join('\n');

  const params = new URLSearchParams({
    name: `${job.title || '(untitled job)'} — ${job.company || ''}`,
    desc,
    idList: SAVED_LIST_ID,
    urlSource: job.url,
    key: auth.key,
    token: auth.token
  });
  const res = await fetch(`${T}/cards?${params}`, { method: 'POST' });
  if (!res.ok) throw new Error('Trello ' + res.status);
  return res.json();
}

// Server-side extraction from the shared URL's HTML: og: meta tags first,
// JSON-LD JobPosting if present, title-tag heuristics as fallback.
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
               : url.includes('seek.com') ? 'Seek'
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
