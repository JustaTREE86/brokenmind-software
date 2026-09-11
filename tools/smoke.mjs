// Reads the live website the way the app does (cold read, continuation, warm re-sync) and prints
// what staff would see against the seed state.
import { readFileSync } from 'node:fs'
import { scrapeStock } from '../api/_lib/scrape.js'
import { reconcile } from '../api/_lib/cards.js'
const seed = JSON.parse(readFileSync(new URL('../api/_lib/seed.json', import.meta.url)))

let prev = [], run = 0, r
do {
  const t0 = Date.now()
  r = await scrapeStock(prev)
  prev = r.cars
  console.log(`sync ${++run}: ${r.listed} listed, ${r.fetched} fetched, ${r.pending} still unread, ${r.failed.length} failed, ${((Date.now() - t0) / 1000).toFixed(1)}s`)
} while (r.pending > 0 && run < 5)

const t1 = Date.now(); r = await scrapeStock(prev)
console.log(`warm re-sync: ${r.fetched} fetched, ${((Date.now() - t1) / 1000).toFixed(1)}s`)

const { cars, sold } = reconcile(r.cars, { printed: seed.printed, titles: seed.titles })
for (const c of cars.filter(c => c.status !== 'ok')) console.log(`  ${c.status.padEnd(8)} ${c.id}  ${c.title}  | ${c.changes.join(' ; ')}`)
console.log(`  ok: ${cars.filter(c => c.status === 'ok').length}`)
for (const s of sold) console.log(`  SOLD     ${s.id}  ${s.title}`)
