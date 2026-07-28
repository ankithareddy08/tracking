# Link Tracker

Paste any URL, get back **one** short link. Share it anywhere — WhatsApp,
Instagram, Google, email — and it works out which platform each visitor arrived
from on its own, then redirects them to the original site.

```bash
npm install
cp .env.example .env    # then set IP_SALT
npm start               # http://localhost:3000
```

## How it works

One link serves every platform. The source is resolved from the request, and only
when that comes up empty does the browser get asked for a second opinion:

```
visitor clicks  http://localhost:3000/one
        │
        ├─ look up the code                       → destination
        ├─ resolve source from headers            → referrer / in-app UA / ?s= tag
        ├─ write one row to `clicks`              → sub-millisecond, synchronous
        │
        ├── confident?  ──yes──► 302 straight to the destination
        │                        (nothing rendered, zero added latency)
        │
        └── unsure?     ──────► ~1 KB HTML page that fires a sendBeacon with
                                 client-only signals and immediately calls
                                 location.replace(destination)
                                        │
                                        └─► POST /api/probe upgrades the row
```

The click is written *before* either branch, so a visitor with JavaScript off
still counts — they just stay in the lower-confidence bucket. If the write throws
it is logged and the redirect happens anyway: analytics never costs you a click.

Crawlers always get the plain 302, so a preview card can never render the
interstitial.

## What it can and cannot detect

| Confidence | Method | Covers |
|---|---|---|
| `exact` | `?s=<channel>` appended by you | Anything you choose to tag |
| `high` | `Referer` matched a known host | Google, Bing, Facebook, Twitter/X, LinkedIn, Reddit, Pinterest, YouTube |
| `high` | Native app package in referrer (`android-app://com.whatsapp`) | **WhatsApp, Instagram, Telegram etc. on Android** |
| `high` | Branded in-app browser User-Agent | Instagram, Facebook, TikTok, Snapchat, LinkedIn, Twitter, Pinterest, WeChat &mdash; **only when opened from that platform's own mobile app**, never its website |
| `high` | `document.referrer` read in the browser | Webviews that drop the header but keep the JS referrer |
| `medium` | Webview globals detected client-side | Some app, but the app did not name itself |
| `low` | `Sec-Fetch-Site: cross-site` with no referrer | Came from *a* website that hid its identity |
| `none` | Nothing at all | Typed the URL, a bookmark, WhatsApp on iPhone, or Instagram/Facebook web |

**Two real gaps, same root cause.**

1. **WhatsApp on iPhone** opens links in a plain Safari view: no referrer, no
   branded User-Agent, no webview marker.
2. **Instagram and Facebook's own websites strip the referrer on outbound
   links by design** (a Meta privacy measure), regardless of device. A link
   clicked on `instagram.com` or `facebook.com` in *any* browser — desktop or
   mobile — carries zero identifying signal, even though the platform's
   in-app mobile browser is detected fine. This is not a bug: `document.referrer`
   is empty in that case too, so there is genuinely nothing left to read.

Both are indistinguishable from someone typing the URL, and land in `Direct` or
`Other site`. No tracker can detect them from the request alone — anything
claiming otherwise is guessing. Append `?s=whatsapp`, `?s=instagram`, etc. when
you share on that platform and it becomes `exact`.

Android is a partial exception for WhatsApp specifically: it sends
`android-app://com.whatsapp` as the referrer, so WhatsApp traffic from Android is
detected automatically. Instagram/Facebook strip referrer on both platforms.

Every number in the UI is badged with how it was determined, so an inferred
result is never displayed as though it were measured.

## Bot filtering

Chat apps fetch a URL the moment it is pasted, to build the preview card. Those
hits arrive before any human clicks. They are stored but excluded from every
headline number, with the filtered count shown on the dashboard so nothing is
silently dropped. Note that a `WhatsApp/2.x` User-Agent is always the crawler,
never a real visitor.

## Privacy

Raw IP addresses are never written to disk. Unique visitors are counted via an
HMAC-SHA256 of IP + User-Agent salted with `IP_SALT`, truncated to 128 bits —
one-way, so the database holds nothing that points back at a person. Keep
`IP_SALT` stable or unique-visitor counts reset.

No IP geolocation is performed. The country column is populated only when a CDN
in front of the app resolves it (`CF-IPCountry` and friends).

## API

```bash
# create — one link back
curl -X POST localhost:3000/api/links -H 'Content-Type: application/json' \
  -d '{"destination":"example.com/sale","title":"Sale","customSlug":"sale"}'

curl localhost:3000/api/links                  # all links + totals
curl localhost:3000/api/links/<groupId>        # full report for one URL (?days=30)
curl -X DELETE localhost:3000/api/links/<id>   # delete, clicks cascade
curl localhost:3000/api/channels               # channel catalogue
```

`POST /api/links` still accepts an optional `"channels": ["whatsapp", ...]` array
if you ever want pre-tagged variants minted alongside the main link. The UI does
not offer it — `?s=<channel>` on the single link does the same job.

`POST /api/probe` is internal: the interstitial calls it to upgrade a click. It
requires an HMAC token bound to the click id ([src/token.js](src/token.js)), so
attribution on a visit cannot be rewritten by anyone else, and the `refined = 0`
guard makes it single-use.

## Layout

| Path | Role |
|---|---|
| [src/app.js](src/app.js) | Express app: route order, error handling — no `listen()` |
| [server.js](server.js) | Local/Railway entry point: imports the app, calls `listen()` |
| [api/index.js](api/index.js) + [vercel.json](vercel.json) | Vercel entry point: same app, no `listen()` |
| [src/channels.js](src/channels.js) | Channel catalogue + all attribution rules |
| [src/routes/redirect.js](src/routes/redirect.js) | The `/:code` hot path |
| [views/interstitial.ejs](views/interstitial.ejs) | Client-side probe, only served when unsure |
| [src/token.js](src/token.js) | Signs click ids so probes cannot be forged |
| [src/db.js](src/db.js) | Database schema, queries, visitor hashing (local file or Turso) |
| [src/auth.js](src/auth.js) | `ADMIN_PASSWORD` gate on the dashboard/API |
| [src/report.js](src/report.js) | Assembles the analytics view model |
| [src/url.js](src/url.js) | Destination validation, UTM tagging |
| [views/](views/) | EJS templates |

`src/routes/redirect.js` is mounted **last** in `src/app.js` — it claims every
remaining single-segment path, so it must not shadow `/api` or `/app`. New
top-level routes go above it, and their prefixes belong in `RESERVED_CODES`
([src/config.js](src/config.js)) so no short code can ever collide with them.

## Authentication

The dashboard (`/`, `/app/*`) and the link-management API (everything in
`/api` except `/api/probe`) sit behind a single shared password once
`ADMIN_PASSWORD` is set ([src/auth.js](src/auth.js)) — HTTP Basic Auth, any
username. Unset, there is no gate at all, which is fine on localhost and not
fine on a public host. The redirect itself (`/<code>`) and `/api/probe` are
**never** gated: real visitors and the tracking beacon must keep working
without credentials.

Still missing: **rate limiting** on `POST /api/links`. Low risk once
`ADMIN_PASSWORD` is set, since only you can hit it.

## Database

Data lives behind `src/db.js`, which talks to either mode of the same
[libSQL](https://turso.tech) client:

- **Local file** (default) — no account needed. Used automatically whenever
  `TURSO_DATABASE_URL` is unset; writes to `DB_PATH`, same as a plain SQLite
  file.
- **Hosted Turso database** — used when `TURSO_DATABASE_URL` (and
  `TURSO_AUTH_TOKEN`) are set. Required on any host with no writable disk,
  which is the case for Vercel's serverless functions.

Schema creation and migrations run automatically on first query — there is no
separate migration step to remember.

## Deploying for free (Vercel + Turso)

This is the $0 path: Vercel's Hobby plan is free with no card, and Turso's free
tier (no card either) covers the database. Trade-off versus a traditional host:
every request adds one small network round trip to the database instead of
reading a local file, and Vercel's serverless functions mean the app restarts
cold on every fresh burst of traffic rather than staying warm.

**1. Create the database** (one-time, needs a free Turso account — turso.tech):

```bash
npm install -g @turso/cli   # or: curl -sSfL https://get.tur.so/install.sh | bash
turso auth login             # opens a browser — this is your account, do it yourself
turso db create link-tracker
turso db show link-tracker --url          # -> TURSO_DATABASE_URL
turso db tokens create link-tracker       # -> TURSO_AUTH_TOKEN
```

**2. Deploy** (needs a free Vercel account — vercel.com):

```bash
npm install -g vercel
vercel login    # opens a browser — your account, do it yourself
vercel          # deploys this folder; answer the setup prompts
```

**3. In the Vercel dashboard for this project**, set environment variables:

```
TURSO_DATABASE_URL=<from step 1>
TURSO_AUTH_TOKEN=<from step 1>
IP_SALT=<paste the value already in your local .env>
ADMIN_PASSWORD=<pick a real password>
BASE_URL=https://<the *.vercel.app domain Vercel just gave you>
```

`IP_SALT` must be copied over, not regenerated — a new salt resets unique
visitor counts. `BASE_URL` is chicken-and-egg on the very first deploy: deploy
once, copy the domain Vercel assigns, set `BASE_URL`, then redeploy (`vercel
--prod`) so freshly generated links use it.

**Adding your own domain later** (e.g. `go.flashbackai.xyz`): add it under
Domains in the Vercel project settings, point a CNAME at the target it gives
you — still free — then update `BASE_URL` to match and redeploy.

## Alternative: Railway (~$5/month, zero code changes)

If the small monthly cost is ever acceptable, Railway needs none of the Turso
setup — it gives the app a real persistent disk, so the local-file database
mode works as-is:

```bash
npm install -g @railway/cli
railway login
railway init
railway volume add      # mount path: /data
railway up
```

Then set `DB_PATH=/data/tracking.db`, `IP_SALT`, `ADMIN_PASSWORD`, and
`BASE_URL` the same way as above, using the `*.up.railway.app` domain Railway
assigns.
