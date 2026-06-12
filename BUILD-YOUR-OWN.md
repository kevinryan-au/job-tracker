# Build your own tracker

Job Tracker is one instance of a reusable pattern:

> **any site you browse → grab structured data on click → send it to the tool where you actually work**

This guide names the seams so you can swap either end. You don't need to be a developer — the
whole point is that you can hand this repo to Claude and describe what you want. But knowing the
shape helps you ask for the right things.

## The anatomy

| Role | File(s) | What it knows |
|---|---|---|
| **Source adapters** | `extension/content-seek.js`, `extension/content-linkedin.js` | How to spot a job page, extract its fields, and show the Save button. One file per site; they know nothing about Trello. |
| **The spine** | `extension/background.js` | Owns local storage and dedup. Routes every save/move/delete. Knows nothing about any site's DOM. |
| **Destination adapter** | `extension/trello.js` | The only file that talks to Trello. Six functions: validate, find-or-create board, find card by URL (the dedup lookup), create card, move card, archive card. |
| **Local tracker** | `extension/popup.html/js` | The UI over local storage. Works with no destination connected at all. |
| **Setup UI** | `extension/options.html/js` | Where the user connects the destination (token paste, board creation). |
| **Extra entry points** | `mobile/worker.js` | A way in for surfaces the extension can't reach (the phone). Optional. |

Three properties make the pattern resilient — keep them when you adapt it:

1. **Local storage is the source of truth.** The destination is a sync target. If it's down,
   unconfigured, or rate-limited, saving still works.
2. **Dedup keys on a canonical URL.** Every source adapter reduces a messy URL
   (`?ref=search&trk=...`) to one canonical form (`/jobs/view/12345/`). That's what makes
   "save it twice, get one card" work across devices.
3. **Adapters are thin and isolated.** When a site redesign breaks scraping (it will), the blast
   radius is one file.

## Swap the source: save from a different site

What's involved (using "add Indeed" as the example):

1. Copy `content-seek.js` → `content-indeed.js`
2. Change `getJobId()` — how does a job URL identify the job? (path segment? query param?)
3. Change `extractJob()` — pull title/company/location from the new site's DOM
4. Add the site to `manifest.json`: a `content_scripts` entry and a `host_permissions` entry
5. Reload the extension

The prompt to give Claude:

> "Add support for saving from indeed.com. Here's a job listing URL: [paste one]. Look at
> content-seek.js for the pattern."

**The scraping lesson we learned the hard way:** prefer signals a site *can't easily change* over
ones it changes constantly. CSS class names are the worst anchor — LinkedIn randomizes theirs on
every deploy. The stable signals: `document.title` (usually "Job Title | Company | Site"), URL
patterns (`href*="/company/"`), data attributes (`data-automation="job-title"`), and JSON-LD
metadata. `content-linkedin.js` is the worked example of building on stable ground.

## Swap the destination: send jobs somewhere else

What's involved (using "Notion instead of Trello" as the example):

1. Replace `trello.js` with `notion.js` implementing the same six-function contract:
   `validate`, `findOrCreateBoard` (→ database), `findCardByUrl` (→ the dedup query),
   `createCard` (→ page), `moveCard` (→ status property update), `archiveCard`
2. Update `options.html/js` — what credential does the new destination need, and where does a
   user get one? (Notion: an internal integration token from notion.so/my-integrations)
3. Add the API host to `host_permissions` in `manifest.json`
4. Keep the dedup contract: write the canonical URL somewhere findable (Notion: a URL property
   you can query) so `findCardByUrl` still works

The prompt to give Claude:

> "Replace the Trello destination with Notion. I want saves to land in a Notion database with a
> Status select property. Keep the local tracker and the dedup behaviour."

Destinations that fit this shape well: Notion, Airtable, Google Sheets (needs OAuth — more setup
friction), GitHub Issues, a plain webhook into Zapier/Make/n8n.

## Add an entry point: reach surfaces the extension can't

The phone was ours (see `mobile/`): a share-sheet Shortcut → tiny Worker → same board, same
dedup. The recipe generalizes — anything that can fire a URL at a Worker becomes an entry point:

- An Android share target (HTTP Shortcuts app)
- A bookmarklet for browsers where you can't install the extension
- An email-this-link address (Cloudflare Email Workers)

The invariant: every entry point converges on the same destination **with the same canonical-URL
dedup**, so entry points never fight each other.

## Change the domain entirely

Nothing here is job-specific. The same five files, renamed: recipes → Notion meal planner;
rental listings → spreadsheet with commute times; conference talks → reading list; products →
price-watch board. Change what `extractJob()` pulls and what the lists are called, and it's a
different tool.

The prompt:

> "Read BUILD-YOUR-OWN.md and CLAUDE.md. I want this same pattern but for [X site] going to
> [Y tool], tracking [stages]. Walk me through it."

## Gotchas Claude should know about (and you might hit)

- **MV3 + CORS:** the extension's service worker can call third-party APIs directly *only* for
  hosts listed in `host_permissions`. Forgetting the manifest entry looks like a CORS bug.
- **Rate limits:** Trello allows ~100 requests per 10s per token. The batch operations
  (`TRELLO_SYNC_ALL`, `CLEAR_ALL`) deliberately go one-at-a-time with delays. Keep that pattern
  for any destination.
- **Canonical URLs across entry points:** if the extension and the mobile worker derive
  different canonical forms for the same job, dedup silently fails. The logic lives in each
  source adapter *and* `mobile/worker.js` — change both or save twice.
- **The dedup contract:** board-level dedup searches card descriptions for the full
  `Link: <url>` line (newline-terminated, so a short job id can't match a longer one). If you
  change the card format, update `trelloFindCardByUrl` — and `mobile/worker.js` — to match.
- **Reload after every change:** unpacked extensions don't hot-reload. `chrome://extensions` →
  refresh icon, then reload the target site's tab too (content scripts inject at page load).
