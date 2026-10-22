# Autozone apps

Two apps behind one login, both fed by the same read of autozoneqldptyltd.com:

- **`/autozone`** — window cards. Staff see which cards need printing, and print them or download
  PDFs. Nothing is typed in.
- **`/autozone/deals`** — the finance deal board. Where every referral to Buyer Assist is up to,
  and the tax invoice requests Autozone need to action.

This `tools/` folder is not deployed (see `.vercelignore`).

## The deal board (`/autozone/deals`)

Autozone refer a customer for finance; Josh runs the application; the board is how the dealership
sees where it is up to without ringing him. Read-only for Autozone, read/write for Josh — which
password was used at login decides which, and the rule is enforced in `api/_lib/http.js`, never in
the page.

- **Autozone to do: send these tax invoices.** Once Josh marks a deal Approved he fills in the
  figures and sends an invoice request. It lands at the top of Autozone's board with the balance
  due, and stays there until he ticks the invoice off as received.
- **Check these cars.** A car that has come off the website while its finance is still running.
  Usually it sold to a cash buyer and nobody told the broker.
- Deals are grouped by phase, closest to settling first, with the car and its photo as the first
  column — Autozone recognise deals by the car, not the customer.
- Every deal links back to the listing the customer enquired on. The car is snapshotted when it is
  linked (VIN, colour, odometer, price), so the deal still reads correctly after the listing is
  taken down.
- Notes are append-only. Stage moves, invoice requests and archiving write their own history line.

No commission or brokerage is stored or shown anywhere. The only money on the board is the car's
own price and the invoice figures, which are Autozone's numbers to begin with.

### The invoice request

Plain text, built on the server (`invoiceText` in `api/_lib/deals.js`) so the printed, copied and
emailed versions are the same words. It carries what Autozone's admin needs to type their tax
invoice: who to invoice and deliver to, the vehicle with VIN and odometer off their own listing,
each charge and credit, the balance due, and who pays. Engine **size** is included because that is
what the website publishes; the engine number stays for Autozone to fill in.

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
| `AZ_STAFF_PASSWORD` | Autozone's password. Window cards, and the deal board read-only. Set for Production (and Preview to test). Changing it logs everyone out. |
| `AZ_BAG_PASSWORD` | Josh's password. Same two apps, plus every write on the deal board. **Until this is set, nobody can change anything on the board** — Autozone's password still works, read-only. |
| `AZ_INVOICE_EMAIL` | Where "Email to Autozone" addresses the invoice request. Unset just means the email opens with an empty To. |
| `BLOB_READ_WRITE_TOKEN` | Added automatically for the private Blob store `autozone-cards` (Sydney). |
| `AZ_SESSION_SECRET` | Optional. Signs sessions instead of the password. Leave unset. |

Sessions issued before the two passwords existed are still honoured, as Autozone, so deploying this
does not log the dealership out of the window-card app.

Functions run in `syd1`. Hobby plan limits apply (60s per request).

**Login lockout:** 5 wrong passwords from one address within 15 minutes locks that address for 15
minutes (`api/_lib/lockout.js`). Staff in one office share an address, so a run of typos locks the
whole office briefly. Records are hashed and kept per environment (`logins-production.json`,
`logins-preview.json`), so testing a preview never locks the live site. To lift a lock early,
delete `autozone/logins-production.json` from the Blob store.

## Where things live

| | |
|---|---|
| `autozone/index.html` | the window-card page |
| `autozone/deals/index.html` | the deal board |
| `api/autozone/deals.js` | the board's one GET: deals, the car picker, the stage rules |
| `api/autozone/deal-update.js` | every write, chosen by `action`. Buyer Assist only |
| `api/_lib/deals.js` | the stage list, validation, the invoice request and its maths |
| `autozone/engine.html` | the card renderer: the Card Studio itself, stock emptied, plus a small bootstrap. **Generated, do not edit.** |
| `api/autozone/*` | `stock` (website sync, statuses, repayment photos), `update` (printed / removed / rename / undo), `pdf`, `photo`, `login` |
| `api/_lib/finance.js` | deposit, rate, term, fees, balloon, the weekly figure and the disclaimer |
| `api/_lib/scrape.js` | reads the public Autozone inventory feed and listing pages |
| `api/_lib/cards.js` | the status rules (new, relisted, changed, sold, duplicate) |
| `api/_lib/store.js` | Blob storage: `autozone/state.json` (cards in windows), `autozone/sync.json` (last website read) and `autozone/deals.json` (the board) |
| `api/_lib/seed.json` | starting state: the 33 cards printed 11 Sep 2026, from the Card Studio |

## Changing the card design or the licence line

Edit the Card Studio (`01-Buyer Assist Group/autozone-per-week/Autozone-Card-Studio.html`), then:

```
npm run engine
npm test
```

and commit `autozone/engine.html`. Staff cannot change any of it from the app.

## Changing the repayment terms

Deposit, rate, term, fees and balloon live in `api/_lib/finance.js`. That file is what the
repayment photos use, and `npm run engine` copies it into the card (over the studio's numbers)
so the window card and the photo cannot disagree. Change the numbers there, run `npm run engine`,
and commit `autozone/engine.html` with it.

## Repayment photos

Each car gets one jpeg: a listing photo with no price already painted on it, a small "From $X/wk" badge,
and one line of fine print, in the clearer bottom corner, of the same terms the card uses. The card keeps the full disclaimer. If the first
photo is a marketing card (a per-week price baked into the picture), the next gallery photo is
used. If every photo already has a price on it, nothing is stamped and the car is marked
"Needs clean photo". The stock sync makes the jpeg when a car is new or the price, photo, terms
or photo layout have changed, and stores it in the private Blob next to the card state
(`autozone/photos/<id>.jpg`). Staff download it from the car's row, or from beside that car's
window card. There is no bulk download.

## Sync behaviour

The sitemap can omit new stock and keep old modification dates after price edits. Discovery uses
the dealer's public Vehica inventory feed, validating the returned count before reconciling sold
cars. Incomplete or invalid feeds retain the previous stock with an error. Every sync re-reads every
listing. A check can take about a minute over multiple requests. A persisted `refreshStartedAt`
lets the next request continue where the previous one stopped, even when old prices are cached.
Until the check finishes, the app does not replace the displayed stock. Failed listings retain
their previous details and produce a visible warning. The open page checks again every ten minutes.

## Local testing

```
vercel env pull .env.local
```

then make a `.env` with `BLOB_READ_WRITE_TOKEN` copied from `.env.local`, plus
`AZ_DEV_NO_AUTH=1` and `AZ_BLOB_PREFIX=autozone-dev` (skips login on localhost only, and keeps test
data out of the live state). Run `vercel dev`. `node tools/smoke.mjs` prints what staff would see
against the live website.

The dev bypass signs you in as Buyer Assist so writes can be tested. Add `AZ_DEV_ROLE=az` to see
the board as Autozone do.
