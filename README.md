# Job Clipper

A Chrome extension that saves jobs from Seek and LinkedIn to a Trello board with one click.

## How it works

- A **Clip** button appears on every Seek and LinkedIn job listing
- Clicking it sends the job to your personal Trello "Job Hunt" board (Saved → Applied → Interview → Offer / Rejected)
- All Trello API calls go through a Cloudflare Worker you deploy to your own account — no shared backend, no third-party storing your data
- Dedup is built in: clipping the same job twice won't create two cards

## Setup

Setup is automated via Claude Code. If you have it installed:

1. Clone or download this repo
2. Open the folder in Claude Code
3. Say **"set this up"**

Claude will handle the rest: deploying your Worker, creating your Trello board, configuring the extension. The only manual step is loading the extension unpacked in Chrome at the end (Claude will tell you exactly how).

No Claude Code? Follow the manual steps in `CLAUDE.md`.

## Requirements

- Chrome (or any Chromium browser)
- A free [Cloudflare](https://cloudflare.com) account
- A free [Trello](https://trello.com) account
- [Node.js](https://nodejs.org) (for Wrangler, the Cloudflare CLI)

## Structure

```
job-clipper/
├── extension/          ← Chrome extension (load this folder unpacked)
│   ├── manifest.json
│   ├── background.js
│   ├── content-linkedin.js
│   ├── content-seek.js
│   ├── popup.html / popup.js
│   └── icons/
└── worker/             ← Cloudflare Worker (deploy this)
    ├── worker.js
    └── wrangler.toml
```

## Updating

Seek and LinkedIn occasionally change their page structure, which can break the Clip button. If that happens:

- Open the project in Claude Code
- Describe the problem (e.g. "the button doesn't appear on Seek")
- Claude will inspect the live page and fix the scraper

## License

MIT
