// One-off: builds api/_lib/seed.json, the app's starting state, from the Card Studio.
// The studio's stock list is exactly what went onto the cards printed on 11 Sep 2026, so:
//   printed = those 33 cards, as printed
//   seedTitles = the names as tidied in the studio, for those exact listing ids (not carried on a re-list)
// Anything the dealer has changed on the website since then shows up in the app as a reprint.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const studio = readFileSync(path.join(root, '..', '..', '01-Buyer Assist Group', 'autozone-per-week', 'Autozone-Card-Studio.html'), 'utf8')
const block = studio.match(/var STOCK = \[\r?\n([\s\S]*?)\r?\n\];/)[1]
const rows = block.split('\n').map(l => l.trim().replace(/,$/, '')).filter(Boolean).map(l => JSON.parse(l))

const at = process.argv[2] || '2026-09-11T00:00:00.000Z'
const printed = {}, seedTitles = {}
for (const r of rows) {
  const id = (r.short.match(/[?&]p=(\d+)/) || [])[1]
  if (!id) throw new Error('No listing id for ' + r.title)
  seedTitles[id] = r.title
  printed[id] = { id, vin: r.vin || '', title: r.title, year: r.year, price: r.price, odometer: r.odometer,
    transmission: r.transmission, fuel: r.fuel, drive: r.drive, warranty: r.warranty, short: r.short,
    make: r.make, model: r.model, printedAt: at }
}
writeFileSync(path.join(root, 'api', '_lib', 'seed.json'), JSON.stringify({ printed, seedTitles }, null, 1))
console.log(`seed.json: ${Object.keys(printed).length} cards in windows, ${Object.keys(seedTitles).length} names`)
