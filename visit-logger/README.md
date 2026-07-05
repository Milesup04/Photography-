# Visit Logger

Create a link, share it, and see **every visit** to it — with the visitor's
**IP address**, browser (user-agent), time, and referrer — in a password-protected
dashboard. Built as a small Node app so it can log visitor IPs correctly on the
**server side** (which is the only reliable way; a static site cannot do this).

This is the transparent, analytics-style version of an "IP grabber": the IP is
read from the actual network connection instead of a hidden client-side trick,
and the dashboard is locked behind an admin key so it isn't an open
grab-anyone's-IP service.

## What it does

1. You log in (Basic Auth) and **create a link** — e.g. `https://your-app.com/v/9mpbxrp`.
2. Optionally give it a **redirect URL** so visitors get forwarded to a real page
   after the visit is logged (like a link shortener). Leave it blank and visitors
   see a simple "visit logged" confirmation page.
3. Every visit is recorded and shown in your **dashboard**: time, IP, user-agent, referrer.

## Run it locally

```bash
cd visit-logger
npm install
ADMIN_KEY=pick-a-long-password npm start
```

Then open <http://localhost:3000>. When the browser asks for a username/password,
leave the username blank (or type anything) and enter your `ADMIN_KEY` as the password.

## Deploy it (so the link works for anyone)

To log real visitors you need a public URL, so host it on any Node platform —
[Render](https://render.com), [Railway](https://railway.app), [Fly.io](https://fly.io),
etc. General steps:

1. Push this folder to a repo (already done if you're reading this on GitHub).
2. Create a new **Web Service** on your host, pointed at this `visit-logger` directory.
3. Build command: `npm install` — Start command: `npm start`.
4. Set environment variables:
   - `ADMIN_KEY` — your dashboard password (required; pick something long).
   - `DATABASE_PATH` — e.g. `/data/visits.db` if the host gives you a persistent disk,
     otherwise the database resets on redeploy.
5. The host provides the public URL; your tracking links live at `<that-url>/v/<code>`.

The app calls `app.set("trust proxy", true)`, so on these hosts `req.ip` resolves the
real visitor IP from `X-Forwarded-For` rather than the proxy's address.

## Configuration

| Variable        | Purpose                                          | Default            |
|-----------------|--------------------------------------------------|--------------------|
| `ADMIN_KEY`     | Password for the home page + dashboard.          | random (printed)   |
| `PORT`          | Port to listen on.                               | `3000`             |
| `DATABASE_PATH` | SQLite file location.                            | `./data/visits.db` |

## Routes

| Route             | Auth  | Purpose                                        |
|-------------------|-------|------------------------------------------------|
| `/`               | admin | Create a new tracking link.                    |
| `/dashboard`      | admin | List all links and visit counts.               |
| `/dashboard/:code`| admin | See every visit (IP, UA, time, referrer).      |
| `/v/:code`        | public| The link you share — logs the visit.           |
| `/healthz`        | public| Health check.                                  |

## Use it responsibly

IP addresses are personal data in many places (e.g. under GDPR). Only log visits
to content **you own or operate**, disclose the logging in a privacy policy, and
don't use this to profile, locate, or de-anonymize specific people without their
knowledge. Follow the laws that apply to you and the terms of your hosting provider.

## Tech

Node + [Express](https://expressjs.com) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3).
No build step. Rewritten from a Remix/Prisma tutorial into a small self-contained
server that captures IPs server-side and keeps the dashboard behind an admin key.
