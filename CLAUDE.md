# CLAUDE.md — map of this codebase for Claude

Job Clipper is a Chrome (MV3) extension that clips job listings from Seek and LinkedIn into a
local tracker, with optional sync to the user's Trello board, plus an optional Cloudflare Worker
that lets an iOS Shortcut clip from the phone. It is also a **template**: users are encouraged to
ask you to adapt it — new source sites, new destinations, new entry points. `BUILD-YOUR-OWN.md`
is the human-facing version of that pitch; this file is your map.

There is **no build step and no dependency install**. Every file ships as-is; after editing,
the user reloads the extension at `chrome://extensions` (refresh icon) and reloads the target
site's tab.

## Layout

```
extension/               the Chrome extension (load this folder unpacked)
  manifest.json          MV3 config — host_permissions gate ALL cross-origin fetches
  content-seek.js        source adapter: Seek (button injection + DOM scraping)
  content-linkedin.js    source adapter: LinkedIn
  background.js          THE SPINE — classic service worker; single writer of storage,
                         single owner of Trello calls; message router
  trello.js              destination adapter — only file that talks to api.trello.com;
                         loaded into the SW via importScripts (NOT an ES module)
  popup.html/js          tracker UI; pure view, mutates only via messages to background
  options.html/js        Trello connect/disconnect/sync UI; pure view, same rule
mobile/                  OPTIONAL phone add-on (Cloudflare Worker + iOS Shortcut recipe)
  worker.js              GET /clip?url= → server-side scrape → Trello card
  README.md              human setup guide (deploy + Shortcut)
```

## Data flow and contracts

**Storage (chrome.storage.local), background.js is the only writer:**

- `jobs` — array of `{ title, company, location, salary, url, source, date, status,
  trelloCardId? }`. `url` is the **canonical URL** and is the identity key for everything.
  `status` ∈ saved | applied | interview | offer | rejected.
- `trelloConfig` — `{ key, token, boardId, boardUrl, boardName, lists: {saved…rejected → listId},
  username }`, or absent when not connected. Absent ⇒ extension runs local-only (this is a
  supported first-class mode, not an error state).

**Messages into background.js** (content scripts, popup, options all use these):
`SAVE_JOB {job}` · `UPDATE_STATUS {url, status}` · `DELETE_JOB {url}` · `CLEAR_ALL` ·
`IMPORT_JOBS {jobs}` · `TRELLO_STATE` · `TRELLO_AUTH_URL {key?}` · `TRELLO_CONNECT {key?, token}` ·
`TRELLO_DISCONNECT` · `TRELLO_SYNC_ALL`

**Dedup is three layers** (all in background.js): in-flight `Set` → storage scan by `url` →
live board check (`trelloFindCardByUrl`, which matches the newline-terminated `Link: <url>` line
in open cards' descriptions). If a card already exists (e.g. clipped from the phone), its id is
**adopted** onto the local job rather than creating a duplicate. Jobs-mutating message handlers
are serialized through a queue in the router — keep new mutating handlers in the `MUTATING` set
or concurrent read-modify-writes will clobber each other.

## Invariants — do not break these when adapting

1. **Canonical URLs must match across every entry point.** Seek → `https://www.seek.com.au/job/{id}`;
   LinkedIn → `https://www.linkedin.com/jobs/view/{id}/`. The same derivation exists in the
   content scripts AND `mobile/worker.js` — change one, change both.
2. **Card descriptions contain the line `Link: <canonical url>`, newline-terminated.** Board
   dedup matches the full line including the trailing `\n` (the `Saved:` line always follows) —
   `trello.js` and `mobile/worker.js` both write and match it. Changing the card format without
   updating both finders silently kills dedup; dropping the newline anchor lets job id `1234`
   wrongly adopt the card for `12345`.
3. **background.js is a CLASSIC service worker** — it uses `importScripts('trello.js')`. Do not
   convert to ES `import` unless you also set `"type": "module"` in the manifest, and don't add
   `export` statements to `trello.js` (it defines globals).
4. **Any new API host must be added to `host_permissions`** in manifest.json, or the SW's fetches
   die with what looks like a CORS error.
5. **Local-only mode keeps working.** Every Trello call is wrapped so its failure (or absence of
   config) never blocks a local save. Keep that property for any new destination.
6. **Batch Trello operations go sequentially with delays** (`CLEAR_ALL` 150ms, `TRELLO_SYNC_ALL`
   300ms). Trello limits ~100 req/10s per token. Don't parallelize them.
7. **Scrape failure still saves.** Content scripts fall back to `(untitled job)` + URL rather
   than refusing to save.

## Playbooks

### "The button stopped working / clip can't read details" (broken scraper)

The most common request — sites change their DOM constantly. Diagnose in this order:

1. Ask for a URL where it fails. Check whether the **domain or URL shape changed** vs
   `manifest.json` matches and `getJobId()` patterns (this is what broke when Seek moved to
   `au.seek.com`: content script never injected).
2. If the button appears but extraction fails, inspect the **live page** (the user is logged in —
   use their browser via the Chrome MCP if available). Don't guess selectors blind.
3. Rebuild extraction on **stable signals**, not CSS classes — LinkedIn hashes its classes
   randomly every deploy. In order of preference: `document.title` (usually
   "Title | Company | Site"), URL patterns in hrefs (`a[href*="/company/"]`), data attributes
   (`data-automation=…` on Seek), JSON-LD. `content-linkedin.js` shows the approach.
4. Validate the new extractor against the live page before writing it into the file.
5. Remind the user: reload extension at `chrome://extensions`, then reload the job-site tab.

### "Add support for [site]"

1. Get a sample job URL. Work out the job-id pattern and the canonical URL form.
2. Copy the closest content script; rewrite `getJobId()` + `extractJob()` (stable signals — see
   above; check whether the site ships JSON-LD or `data-*` attributes before resorting to DOM
   heuristics).
3. Add `content_scripts` + `host_permissions` entries in manifest.json.
4. Add the source name in the popup's filter row (`popup.html`) and `sources` tally
   (`popup.js → renderStats`) if they want it filterable.
5. If they use the mobile worker, extend its `scrape()` canonical-URL logic for the new site.

### "Send clips to [Notion/Airtable/Sheets/…] instead of Trello"

1. Write a new destination adapter implementing trello.js's contract: `validate`,
   `findOrCreateBoard` (or database/sheet equivalent), `createCard`, `moveCard`, `archiveCard`,
   `findCardByUrl` (the dedup lookup — store the canonical URL somewhere queryable).
2. Keep the function names/messages or rename consistently through background.js.
3. Update `options.html/js` for the new credential and its "where do I get this" help text.
4. Swap the `host_permissions` entry. Check the API actually allows direct calls with a simple
   token (Notion does; Google Sheets needs OAuth — warn the user it's more involved).
5. Keep statuses: saved/applied/interview/offer/rejected map to lists/selects/columns.

### "Set up mobile clipping" (deploy the optional Worker)

Follow `mobile/README.md` with the user, driving the terminal yourself where possible:

1. They must already be connected to Trello in the extension (Settings page).
2. Get their key + token (ask them to paste; they already have both from desktop setup).
3. `curl` Trello for their board id and Saved-list id (commands in mobile/README.md); write them
   into `mobile/worker.js` constants.
4. From `mobile/`: `npx wrangler login` (browser approve) → `npx wrangler deploy` → capture URL.
5. `npx wrangler secret put TRELLO_KEY`, `TRELLO_TOKEN`, and `CLIP_SECRET` (generate a passphrase
   for the latter, e.g. `openssl rand -hex 12` — it gates the endpoint; keep it for step 6 and
   the Shortcut URL).
6. Test: `curl "https://<worker-url>/clip?s=<secret>&url=<real job url>"` — expect
   "Saved to Trello: …", then run again and expect "Already saved". Note `url=` must be the
   LAST query param (the worker reads everything after it, so unencoded `&`s in job URLs survive).
7. Walk them through the Shortcut recipe (mobile/README.md) — that part is on their phone.

### "Help me install it" (desktop)

No terminal needed: download/clone → `chrome://extensions` → Developer mode → Load unpacked →
select `extension/` folder. Then (optional) ⚙ Settings → follow the two-step Trello connect.
If the user forked this repo and baked a shared API key into `trello.js`
(`SHARED_TRELLO_KEY`), step 1 of connect disappears for their users — offer that to forkers.

## Voice and docs

README.md is written in Kevin's first person as a showcase ("built by describing it to Claude") —
keep that voice if you edit it. The story beats (Seek domain move, LinkedIn hashed classes,
duplicate-card race, the phone as Act 2) are real history; don't invent new ones.
