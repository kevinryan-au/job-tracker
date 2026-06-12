# Track jobs from your phone (optional add-on)

The Chrome extension can't follow you into the LinkedIn and Seek **phone apps** — they don't run
extensions. This add-on fixes that with two small pieces:

1. **A Cloudflare Worker** (free tier) — takes a job URL, fetches the page server-side, extracts
   the details, and files a card into your board's *Saved* list, with the same dedup as the extension.
2. **An iOS Shortcut** — adds *Track job* to your phone's share sheet, pointing at the Worker.

Tap **Share** on any job in the LinkedIn or Seek app → **Track job** → the card is on your board.

> Skip this entirely if you only save from your computer — the extension never uses it.
> The fastest way through this setup is to open the repo in Claude Code and say
> **"set up mobile saving"** — `CLAUDE.md` has the playbook. Manual steps below.

## Prerequisites

- The extension already connected to Trello (Settings → Connect) — the Worker reuses the same
  key, token, and board. (Didn't keep the key/token? Re-copy the key at
  [trello.com/power-ups/admin](https://trello.com/power-ups/admin) and click **Get my token** in
  the extension settings to mint a fresh one.)
- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account
- [Node.js](https://nodejs.org) (just to run the deploy tool; nothing runs on your machine afterwards)

## Deploy the Worker

All commands run from this `mobile/` folder.

**1. Find your board and list IDs** (using the same key + token you pasted into the extension):

```bash
# your boards — copy the id of "Job Hunt"
curl -s "https://api.trello.com/1/members/me/boards?fields=name&key=KEY&token=TOKEN"

# its lists — copy the id of "Saved"
curl -s "https://api.trello.com/1/boards/BOARD_ID/lists?fields=name&key=KEY&token=TOKEN"
```

**2. Edit `worker.js`** — set `BOARD_ID` and `SAVED_LIST_ID` (top of the file) to those two IDs.

**3. Deploy:**

```bash
npx wrangler login    # opens Cloudflare in your browser — approve
npx wrangler deploy   # prints your Worker URL when done
```

**4. Set your secrets** (they live in Cloudflare, not in the code):

```bash
npx wrangler secret put TRELLO_KEY     # paste your API key when prompted
npx wrangler secret put TRELLO_TOKEN   # paste your token when prompted
npx wrangler secret put TRACK_SECRET    # invent any passphrase, e.g. from: openssl rand -hex 12
```

`TRACK_SECRET` matters: the endpoint creates cards on your board and fetches whatever URL it's
given, so it must only respond to requests that know your passphrase. Without the gate, anyone
who stumbled on the Worker URL could spam your board.

**5. Test it** — open this in any browser (use a real job URL and your secret):

```
https://job-tracker.<your-account>.workers.dev/track?s=YOUR_SECRET&url=https://www.seek.com.au/job/12345678
```

You should see `Saved to Trello: …` and the card on your board. Run it twice — the second
response should be `Already saved`.

## Create the iOS Shortcut

1. Open the **Shortcuts** app → **+** to create a new shortcut
2. Tap the shortcut's settings (ⓘ) → enable **Show in Share Sheet**. Back in the editor, tap the
   **"Receives Any input"** header and limit it to **URLs** (add **Text** too if a share later
   arrives as plain text)
3. Add the action **URL Encode** with **Shortcut Input** as its input
4. Add the action **Get Contents of URL**, and set the URL to:
   `https://job-tracker.<your-account>.workers.dev/track?s=YOUR_SECRET&url=` followed by the
   **URL Encoded Text** variable from step 3. Keep `url=` as the **last** parameter — job URLs
   contain `&`, and the Worker reads everything after `url=` as the job link
5. Add the action **Show Notification** (or *Show Result*) with **Contents of URL** as its body —
   so you see "Saved to Trello: …" after saving
6. Name it **Track job** and save

Now in the LinkedIn or Seek app: open a job → **Share** → **Track job**.

## Notes

- **Cost:** $0. Cloudflare's free tier allows 100,000 requests/day; you will use a handful.
- **Privacy:** the Worker is yours, on your account, using your token — nothing goes through
  anyone else's server. The endpoint only answers requests carrying your `TRACK_SECRET`.
- **Scraping quality:** server-side extraction reads the page's metadata (og: tags, JSON-LD).
  LinkedIn sometimes serves logged-out pages with less detail — the card still gets the link
  and title, and dedup still works, so fill in anything missing when you next open the board.
- **Android:** the same Worker works with any app that can hit a URL from a share action
  (e.g. HTTP Shortcuts) — the recipe above is iOS because that's what I carry.
