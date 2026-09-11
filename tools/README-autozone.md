# Autozone window-card app

`brokenmind.com.au/autozone`: Autozone QLD staff log in, see which window cards need printing, and
print them or download PDFs. Stock comes straight off autozoneqldptyltd.com. Nothing is typed in.

This `tools/` folder is not deployed (see `.vercelignore`).

## What staff see

- **Cards to print**: new cars, cars the dealer re-listed (their old QR now goes to a 404), and
  cars whose price, name or specs changed. Tick, then Print or Download PDF. Afterwards the app asks
  "are they up in the windows?". Only a yes marks them done, so a cancelled print never hides a car.
- **Sold: take these cards out of the window**: cards for cars no longer on the website.
- **Check: duplicate listing**: the dealer posted a car twice. Unticked by default.
- **Fix name**: tidy a clumsy website title for the card. It follows the car if it is re-listed.
- Every action can be undone from the pop-up, and shows under Recent activity.

## Settings (Vercel project `brokenmind-software`)

| Variable | What |
|---|---|
| `AZ_STAFF_PASSWORD` | The one staff password. Set for Production (and Preview to test). Changing it logs everyone out. |
| `BLOB_READ_WRITE_TOKEN` | Added automatically for the private Blob store `autozone-cards` (Sydney). |
| `AZ_SESSION_SECRET` | Optional. Signs sessions instead of the password. Leave unset. |

Functions run in `syd1`. Hobby plan limits apply (60s per request).

**Login lockout:** 5 wrong passwords from one address within 15 minutes locks that address for 15
minutes (`api/_lib/lockout.js`). Staff in one office share an address, so a run of typos locks the
whole office briefly. Records are hashed and kept per environment (`logins-production.json`,
`logins-preview.json`), so testing a preview never locks the live site. To lift a lock early,
delete `autozone/logins-production.json` from the Blob store.

## Where things live

| | |
|---|---|
| `autozone/index.html` | the staff page |
| `autozone/engine.html` | the card renderer: the Card Studio itself, stock emptied, plus a small bootstrap. **Generated, do not edit.** |
| `api/autozone/*` | `stock` (website sync + statuses), `update` (printed / removed / rename / undo), `pdf`, `login` |
| `api/_lib/scrape.js` | reads the Autozone sitemap and listing pages |
| `api/_lib/cards.js` | the status rules (new, relisted, changed, sold, duplicate) |
| `api/_lib/store.js` | Blob storage: `autozone/state.json` (cards in windows) and `autozone/sync.json` (last website read) |
| `api/_lib/seed.json` | starting state: the 33 cards printed 11 Sep 2026, from the Card Studio |

## Changing the card design, finance basis or licence line

Edit the Card Studio (`01-Buyer Assist Group/autozone-per-week/Autozone-Card-Studio.html`), then:

```
npm run engine
npm test
```

and commit `autozone/engine.html`. Staff cannot change any of it from the app.

## Sync behaviour

The Autozone site is slow (about 1.5s a page), so a sync re-reads only listings whose sitemap
`lastmod` changed, plus up to four of the oldest reads. The first ever sync takes about a minute over
two requests; after that a check is one to three seconds. Until every listing has been read, the app
shows no statuses at all, so an unread car can never look sold.

## Local testing

```
vercel env pull .env.local
```

then make a `.env` with `BLOB_READ_WRITE_TOKEN` copied from `.env.local`, plus
`AZ_DEV_NO_AUTH=1` and `AZ_BLOB_PREFIX=autozone-dev` (skips login on localhost only, and keeps test
data out of the live state). Run `vercel dev`. `node tools/smoke.mjs` prints what staff would see
against the live website.
