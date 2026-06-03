# Job Clipper — Claude Setup Guide

Job Clipper is a Chrome extension that saves jobs from Seek and LinkedIn to a Trello board with one click. It has two parts: a Chrome extension (this folder) and a Cloudflare Worker that handles Trello API calls.

This file tells Claude how to set everything up for a new user. If you've been asked to "set this up", follow the steps below in order.

---

## What you're setting up

```
Chrome Extension  →  Cloudflare Worker  →  Trello Board
(this folder)        (your free account)    (auto-created)
```

- The **Worker** holds Trello credentials and handles all card creation/dedup
- The **extension** scrapes job details from Seek/LinkedIn and sends them to the Worker
- The **Trello board** has five lists: Saved, Applied, Interview, Offer, Rejected

---

## Setup steps

Work through these in order. Each step tells you what to do and what to check before moving on.

---

### Step 1 — Check Node / npm

Run:
```bash
node --version
npm --version
```

If either command fails, tell the user:
> "Please install Node.js from nodejs.org (LTS version), then come back and say 'continue setup'."
> Stop here until they confirm it's installed.

---

### Step 2 — Install Wrangler

Run:
```bash
npm install -g wrangler
wrangler --version
```

If installation fails, try `npx wrangler --version` instead and use `npx wrangler` for all subsequent wrangler commands.

---

### Step 3 — Log in to Cloudflare

Run:
```bash
wrangler login
```

This opens a browser window. Tell the user:
> "A browser window just opened — log in to your Cloudflare account (or create a free one at cloudflare.com) and click Approve."

Wait for them to confirm before continuing.

---

### Step 4 — Get Trello credentials

Tell the user:
> "Open this URL in your browser: https://trello.com/app-key
> You'll see your API Key at the top. Copy it and paste it here."

Save what they paste as TRELLO_KEY.

Then tell them:
> "On the same page, click the 'Token' link (it's just below your API Key). Approve the permission request, then copy the token and paste it here."

Save what they paste as TRELLO_TOKEN.

---

### Step 5 — Create the Trello board and lists

Using the Trello API, create a new board called "Job Hunt" and five lists in this order:
1. Saved
2. Applied
3. Interview
4. Offer
5. Rejected

API calls to make:

**Create board:**
```
POST https://api.trello.com/1/boards/?name=Job%20Hunt&defaultLists=false&key={TRELLO_KEY}&token={TRELLO_TOKEN}
```
Save the board `id` as BOARD_ID.

**Create each list** (in order — Trello displays them in creation order):
```
POST https://api.trello.com/1/lists?name={LIST_NAME}&idBoard={BOARD_ID}&key={TRELLO_KEY}&token={TRELLO_TOKEN}
```
Save each list `id`:
- SAVED_LIST_ID
- APPLIED_LIST_ID
- INTERVIEW_LIST_ID
- OFFER_LIST_ID
- REJECTED_LIST_ID

Use the Bash tool to make these API calls with curl.

---

### Step 6 — Update worker.js with the user's board/list IDs

Edit `worker/worker.js`. Find this block near the top:

```js
const BOARD_ID = '...';
const L = {
  saved:     '...',
  applied:   '...',
  interview: '...',
  offer:     '...',
  rejected:  '...'
};
```

Replace all the IDs with the values captured in Step 5.

---

### Step 7 — Deploy the Worker

From the project root:
```bash
cd worker
wrangler deploy
```

If there's no `wrangler.toml`, create one first:
```toml
name = "job-clipper"
main = "worker.js"
compatibility_date = "2024-01-01"
```

After deploy succeeds, capture the Worker URL from the output — it will look like:
`https://job-clipper.<something>.workers.dev`

Save this as WORKER_URL.

---

### Step 8 — Set Worker environment variables

```bash
echo "{TRELLO_KEY}" | wrangler secret put TRELLO_KEY
echo "{TRELLO_TOKEN}" | wrangler secret put TRELLO_TOKEN
echo "*" | wrangler secret put ALLOWED_ORIGIN
```

Confirm each one succeeds before moving on.

---

### Step 9 — Update the extension with the Worker URL

Edit `extension/background.js`. Find this line near the top:

```js
const WORKER_URL = 'https://job-clipper.kevin-andrew-ryan.workers.dev';
```

Replace the URL with WORKER_URL from Step 7.

Also update `extension/manifest.json` — find the host_permissions entry for `workers.dev` and replace it with the user's Worker URL:

```json
"https://<their-worker-url>/*"
```

---

### Step 10 — Load the extension in Chrome

Tell the user:
> "Almost done — one manual step:
> 1. Open Chrome and go to: chrome://extensions
> 2. Turn on **Developer mode** (toggle, top-right corner)
> 3. Click **Load unpacked** and select the `extension` folder from this project
> 4. Pin the Job Clipper icon by clicking the puzzle piece in the Chrome toolbar
>
> That's it! Go to any Seek or LinkedIn job listing — you'll see a blue Clip button."

---

### Step 11 — Verify everything works

Ask the user to:
1. Go to a Seek or LinkedIn job listing
2. Click the Clip button
3. Check their Trello "Job Hunt" board — a card should appear in the Saved list

If the card doesn't appear, check:
- `chrome://extensions` → Job Clipper → Errors (click the Errors button)
- The Worker logs: `wrangler tail` in the terminal
- That the Trello API key and token were set correctly (Step 8)

---

## Troubleshooting reference

| Symptom | Likely cause | Fix |
|---|---|---|
| Clip button doesn't appear on Seek | URL pattern mismatch | Check manifest.json matches `au.seek.com` and `seek.com.au` |
| Clip button doesn't appear on LinkedIn | Extension not loaded or wrong URL | Check chrome://extensions, reload extension |
| "Extension error — try reloading" toast | Worker URL wrong or Worker not deployed | Check WORKER_URL in background.js matches deployed URL |
| "Save failed" toast | Trello credentials wrong | Re-run Step 8, check key/token are correct |
| Card appears with "(untitled job)" | Site DOM changed, scraper couldn't extract details | Tell the user — this is a known limitation, card has the job URL |
| Duplicate cards | Old cards in Trello with mismatched URLs | One-time issue from before setup; won't recur |

---

## File structure

```
job-clipper/
├── CLAUDE.md                 ← you are here
├── extension/
│   ├── manifest.json         ← host permissions, content script config
│   ├── background.js         ← service worker, routes saves to Worker
│   ├── content-linkedin.js   ← LinkedIn scraper + Clip button
│   ├── content-seek.js       ← Seek scraper + Clip button
│   ├── popup.html/js         ← tracker UI
│   ├── trello.js             ← (legacy, unused)
│   └── icons/
└── worker/
    ├── worker.js             ← Cloudflare Worker (Trello API, dedup)
    └── wrangler.toml         ← created during setup
```

---

## Updating the extension later

If Seek or LinkedIn changes their site structure and the Clip button stops working or can't extract job details:
- The scraper logic is in `extension/content-seek.js` and `extension/content-linkedin.js`
- Open the relevant file and describe the symptom — Claude can inspect the live page and fix the selectors
- After editing, reload the extension at `chrome://extensions` (click the refresh icon)

The Worker rarely needs updating — it only changes if Trello's API changes or you want new features.
