# Job Clipper

**A "save to my job tracker" button for every job site — built by describing it to Claude, not by writing code.**

<!-- TODO: hero GIF — browsing a Seek listing → click "+ Clip job" → toast → cut to Trello, card in "Saved" -->

I was job hunting and drowning in browser tabs. Seek has its own saved list, LinkedIn has another,
and neither talks to the Trello board where I actually track applications. The tool I wanted — a
button on every job listing that files it straight into my pipeline — didn't exist.

So I described it to Claude. This repo is the result: a Chrome extension that puts a **Clip job**
button on Seek and LinkedIn listings and saves them to a Trello board in one click, with status
tracking from *Saved* through to *Offer*.

It's also a demonstration of something bigger: **the gap between "I wish my tools talked to each
other" and "they now do" has gotten very, very small.** I'm a product manager, not a developer.
Total hand-written code in this project: zero.

## What it does

- **One-click clipping** — a button appears on every Seek and LinkedIn job listing; clicking it
  captures title, company, location, salary and a clean canonical URL
- **A pipeline, not a list** — jobs move through Saved → Applied → Interview → Offer / Rejected;
  the popup tracker shows your stats (response rate, source breakdown) and exports CSV/JSON
- **Works with zero setup** — out of the box, everything is stored locally in your browser.
  Connecting Trello is optional, takes a few minutes, and the settings page walks you through it
- **Clips from your phone too** — an optional iOS Shortcut adds *Clip job* to the share sheet
  inside the LinkedIn and Seek apps, feeding the same board with the same dedup
- **No duplicates, no babysitting** — clip the same job twice, even from different devices, and
  it's deduplicated; if a site changes and scraping fails, you still get a card with the link
  instead of a silent failure

## How it works

```
  DESKTOP                          PHONE (optional add-on)
┌─────────────────────────┐     ┌─────────────────────────┐
│  Chrome extension        │     │  iOS Shortcut            │
│  · content script / site │     │  · "Clip job" in the     │
│  · save + dedupe locally │     │    share sheet           │
│  · popup: tracker, CSV   │     └───────────┬─────────────┘
└────────────┬────────────┘                  ▼
             │                   ┌─────────────────────────┐
             │ your token,       │  Cloudflare Worker (free)│
             │ in your browser   │  · fetches the job page  │
             │                   │  · same scrape, same     │
             │                   │    dedup, server-side    │
             │                   └───────────┬─────────────┘
             └──────────────┬────────────────┘
                            ▼
              api.trello.com → your "Job Hunt" board
```

Desktop needs no server at all — your jobs go from your browser straight to your Trello using
your token, which never leaves your machine. The Worker exists only to give your *phone* a way
in; if you skip mobile, you never touch it. Don't use Trello? It works standalone: jobs live in
the extension's local tracker and export to CSV or JSON.

## The interesting part: how it got built (and repaired)

**Act 1: the button.** I described the tool I wanted to Claude — a clip button on every job
listing, filing into my Trello pipeline. One conversation later it existed.

But the part worth showing you is the **maintenance**, because that's where tools like this
usually die. Job sites change their websites constantly, and every change breaks scrapers like
this. Here's what that actually looked like:

| What broke | What fixed it | Time |
|---|---|---|
| Seek moved from `seek.com.au` to `au.seek.com` — button vanished | Told Claude "it stopped working on Seek", pasted a URL. It spotted the domain change and patched the manifest. | ~5 min |
| LinkedIn replaced all its CSS classes with random hashes (`_967cf84a`) that change every deploy | Claude inspected the live page through my browser, found the signals LinkedIn *can't* obfuscate (document title, company URL pattern), and rebuilt the scraper on those. | ~15 min |
| Duplicate Trello cards from double-clicks and clipping on two devices | Claude traced the race condition and added three layers of dedup. | ~10 min |

No documentation reading. No Stack Overflow. The repair loop is: *describe the symptom in plain
English → Claude inspects the live page → fix lands*. That loop is the real product here.

**Act 2: the tool followed my workflow.** Within a few weeks, the extension changed how I job
hunted — and immediately hit its own limit. Most of my actual job browsing happens **on my
phone**, on the couch, on the train. The LinkedIn and Seek apps don't run Chrome extensions. The
clipper couldn't follow me there.

So it grew a second entry point: an **iPhone Shortcut** in the share sheet. Tap *Share* on any
job in the LinkedIn or Seek app → *Clip job* → done. Behind it sits a tiny **Cloudflare Worker**
(free tier) that takes the shared URL, fetches the page, extracts the same fields server-side,
and files the card to the same board — with the same dedup, so a job clipped on the phone and
again at the desk shows up once, not twice.

<!-- TODO: short screen recording — share sheet on phone → Clip job → Trello card appears -->

This is the part of the pattern I most want you to see: **the tool didn't get rebuilt for mobile —
it grew a new front door.** Each entry point is small (a content script; a share-sheet shortcut).
They converge on the same pipeline. When your workflow grows, the tool grows a limb, not a rewrite.

## Try it

> Heads up: this isn't on the Chrome Web Store (deliberately — it's a demo, not a product), so
> install is the manual-but-quick kind, and updates mean re-downloading.

**Level 1 — desktop (5 minutes):**

1. [Download the repo as a zip](https://github.com/kevinryan-au/job-clipper/archive/refs/heads/main.zip)
   and unzip it (or grab a [release](https://github.com/kevinryan-au/job-clipper/releases), or clone)
2. Go to `chrome://extensions`, switch on **Developer mode** (top-right), click **Load unpacked**,
   and choose the `extension` folder
   <!-- TODO: 15-second GIF of exactly this -->
3. Open any Seek or LinkedIn job listing (reload the tab if it was already open) and clip —
   you're already tracking, locally
4. *(Optional, a few minutes)* Click the Job Clipper icon → **⚙ Settings** → connect Trello.
   The settings page walks you through both pieces: a free Trello **API key** (it links you to
   Trello's admin page and shows exactly where to click) and a **token** (one *Allow* click via
   the **Get my token** button). Paste them, hit **Connect & create my board**, and every clip
   lands on a kanban board too. *(Forking for your team? Bake your API key into `trello.js` as
   `SHARED_TRELLO_KEY` and your users skip the key step entirely.)*

**Level 2 — add your phone (15 minutes, optional):**

Deploy the included Worker to your own free Cloudflare account and install the Shortcut — see
[`mobile/README.md`](mobile/README.md). This is the one part with real setup steps, but by the
time you want it, you're already hooked — and if you have [Claude Code](https://claude.com/claude-code),
opening the repo and saying *"set up mobile clipping"* walks you through the whole thing.

## Build your own — this is the actual point

Job Clipper is one instance of a pattern:

> **any site you browse → grab structured data on click → send it to the tool where you actually work**

Recipes clipped to Notion. Properties to a spreadsheet. Papers to Zotero. Leads to a CRM. The
shape is identical — one content script per source site, one thin API client per destination,
local storage as the spine, optional extra entry points (like the phone) when your workflow grows.

This repo is set up so Claude can adapt it for you. Clone it, open it in
[Claude Code](https://claude.com/claude-code), and say something like:

> *"Adapt this to clip from Indeed instead of Seek"*
> *"Send clips to Notion instead of Trello"*

[`CLAUDE.md`](CLAUDE.md) gives Claude a map of the codebase and where the seams are, and
[`BUILD-YOUR-OWN.md`](BUILD-YOUR-OWN.md) is the pattern walkthrough for humans.

## Honest limitations

- **Scrapers rot.** Seek or LinkedIn will change their pages again and the button will break
  again. The fix loop above is the mitigation, not immunity.
- **No auto-updates.** Unpacked extensions don't update themselves; new versions mean
  re-downloading the zip and reloading.
- **Your Trello token lives in your browser's extension storage.** It grants read/write access
  to your **whole Trello account** (Trello tokens aren't board-scoped) and never expires on its
  own — it stays valid until you revoke it under Trello → Settings → Applications. Treat it like
  a password: fine for a personal machine, think twice on a shared one.

## License

MIT. Take it, fork it, point it at your own tools.
