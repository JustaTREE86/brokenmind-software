// Shared state in a private Vercel Blob store (created as `autozone-cards`, Sydney).
//
//   autozone/state.json   which cards are in windows, name fixes, a short activity log
//   autozone/sync.json    the last read of the Autozone website, reused for a few minutes
//   autozone/deals.json   the finance deal board: deals, their notes and their invoice requests
//   autozone/logins-<env>.json  recent wrong passwords per (hashed) address, for the lockout
//
// Writes are compare-and-swap on the blob's ETag, so two staff clicking at once can't overwrite
// each other: the loser re-reads and re-applies.

import { get, put, BlobPreconditionFailedError } from '@vercel/blob'
import { readFileSync } from 'node:fs'
import { scrapeStock } from './scrape.js'

// AZ_BLOB_PREFIX lets local testing use its own copy (autozone-dev) instead of the live state
const PREFIX = process.env.AZ_BLOB_PREFIX || 'autozone'
const STATE = PREFIX + '/state.json'
const SYNC = PREFIX + '/sync.json'
const DEALS = PREFIX + '/deals.json'
// kept per environment, so testing the lockout on a preview can't lock anyone out of the live site
const LOGINS = PREFIX + '/logins-' + (process.env.VERCEL_ENV || 'local') + '.json'
const SYNC_FRESH_MS = 10 * 60 * 1000
const LOG_KEEP = 200

async function readJson(pathname) {
  const r = await get(pathname, { access: 'private', useCache: false })
  if (!r || r.statusCode !== 200) return { data: null, etag: null }
  // Reads of a compressed blob come back with a weak ETag (W/"…"), which never satisfies ifMatch.
  // The hash inside is the blob's real ETag, so compare on that.
  const etag = r.blob.etag ? r.blob.etag.replace(/^W\//, '') : null
  return { data: JSON.parse(await new Response(r.stream).text()), etag }
}

async function writeJson(pathname, data, etag) {
  const opts = { access: 'private', contentType: 'application/json', addRandomSuffix: false }
  if (etag) opts.ifMatch = etag
  else opts.allowOverwrite = pathname === SYNC      // the others are created once, then only swapped
  await put(pathname, JSON.stringify(data), opts)
}

/** Read, change, write back only if nobody else wrote in between; otherwise go round again. */
async function casUpdate(pathname, initial, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, etag } = await readJson(pathname)
    const doc = data || initial()
    const result = change(doc)
    try {
      await writeJson(pathname, doc, etag)
      return { doc, result }
    } catch (e) {
      const raced = e instanceof BlobPreconditionFailedError || /exist|precondition/i.test(e.message || '')
      if (!raced) throw e
    }
  }
  throw new Error('Someone else is saving at the same moment. Try again.')
}

/** First run: every card in the yard as printed on 11 Sep 2026, plus the Card Studio names for those listings. */
function seedState() {
  const seed = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url), 'utf8'))
  return { v: 1, printed: seed.printed, seedTitles: seed.seedTitles, titles: {}, log: [], undo: null }
}

export async function readState() {
  const { data } = await readJson(STATE)
  return data || seedState()
}

/** Apply `change(state)` atomically. `change` mutates and may return a log line. */
export async function updateState(change) {
  const { doc } = await casUpdate(STATE, seedState, state => {
    const note = change(state)
    if (note) state.log = [{ at: new Date().toISOString(), ...note }].concat(state.log || []).slice(0, LOG_KEEP)
  })
  return doc
}

/** The deal board. Empty on first use: unlike the window cards there is nothing to seed. */
const emptyDeals = () => ({ v: 1, seq: 0, deals: [] })

export async function readDeals() {
  return (await readJson(DEALS)).data || emptyDeals()
}

/**
 * Apply `change(doc)` to the deal board atomically, returning whatever `change` returns.
 *
 * Compare-and-swap matters more here than anywhere else in the app: Josh adding a note on his phone
 * while the board auto-refreshes on the dealership's screen must never drop one of the two writes.
 * On a clash the loser re-reads and re-applies, so the note lands on the latest copy.
 */
export async function updateDeals(change) {
  return (await casUpdate(DEALS, emptyDeals, change)).result
}

/** Wrong-password records, keyed by hashed address. See lockout.js. */
export async function readLogins() {
  return (await readJson(LOGINS)).data || {}
}
export async function updateLogins(change) {
  return (await casUpdate(LOGINS, () => ({}), change)).result
}

/**
 * Live stock. Re-reads the website when the cached copy is older than ten minutes (or `force`).
 * If the website can't be reached, the last good read is returned with `error` set.
 */
export async function readStock({ force = false, anyAge = false } = {}) {
  const { data: cached } = await readJson(SYNC)
  const fresh = cached && Date.now() - Date.parse(cached.at) < SYNC_FRESH_MS
  if (cached && (fresh || anyAge) && !force && !cached.pending) return { ...cached, fromCache: true }
  try {
    const { cars, failed, listed, fetched, pending } = await scrapeStock(cached?.cars || [])
    const snap = { at: new Date().toISOString(), cars, failed, listed, fetched, pending }
    await writeJson(SYNC, snap)
    return { ...snap, fromCache: false }
  } catch (e) {
    if (cached) return { ...cached, fromCache: true, error: 'Could not reach the Autozone website: ' + e.message }
    throw e
  }
}

/**
 * Stock for an action (printing, marking done). Uses the last complete read whatever its age, so
 * acting on what staff are looking at is quick, and refuses to act on a half-read website.
 */
export async function readCompleteStock() {
  const stock = await readStock({ anyAge: true })
  if (stock.pending > 0) throw new Error('Still reading the Autozone website. Try again in a moment.')
  return stock
}
