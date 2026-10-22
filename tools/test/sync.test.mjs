import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrapeStock, parseInventory } from '../../api/_lib/scrape.js'

const url = id => `https://autozoneqldptyltd.com/listing/car-${id}/`
const lastmod = '2026-10-08T05:37:49+00:00'
const started = '2026-10-22T00:00:00.000Z'
const previous = id => ({ id: String(id), url: url(id), price: '27880', lastmod,
  fetchedAt: '2026-10-21T23:59:00.000Z' })
const listing = id => `<link rel="shortlink" href="https://autozoneqldptyltd.com/?p=${id}"/>` +
  '<div class="vehica-car-price">$26,880</div>'

function website(t, ids, onListing = () => {}) {
  const requested = []
  t.mock.method(globalThis, 'fetch', async u => {
    if (u.endsWith('/wp-json/vehica/v1/cars')) return Response.json({
      resultsCount: ids.length, results: ids.map(id => ({ url: url(id) }))
    })
    requested.push(u)
    onListing(u)
    const id = ids.find(id => url(id) === u)
    return new Response(listing(id))
  })
  return requested
}

test('refresh picks up price changes even with unchanged sitemap and recently cached listings', async t => {
  const requested = website(t, [1, 2])
  const result = await scrapeStock([previous(1), previous(2)], { refreshStartedAt: started })
  assert.equal(requested.length, 2)
  assert.deepEqual(result.cars.map(c => c.price), ['26880', '26880'])
  assert.equal(result.pending, 0)
})

test('inventory discovers new cars absent from the sitemap and cached stock', async t => {
  website(t, [1, 2, 30878, 30829])
  const result = await scrapeStock([previous(1), previous(2)], { refreshStartedAt: started })
  assert.equal(result.listed, 4)
  assert.equal(result.pending, 0)
  assert.deepEqual(result.cars.map(c => c.id), ['1', '2', '30878', '30829'])
})

test('incomplete, duplicate, empty and off-site inventory feeds are rejected before sold reconciliation', () => {
  for (const data of [
    { resultsCount: 2, results: [{ url: url(1) }] },
    { resultsCount: 2, results: [{ url: url(1) }, { url: url(1) }] },
    { resultsCount: 0, results: [] },
    { resultsCount: 1, results: [{ url: 'https://example.com/listing/car/' }] }
  ]) assert.throws(() => parseInventory(JSON.stringify(data)))
})

test('a timed-out batch stays pending despite cached prices and resumes without repeating completed cars', async t => {
  let clock = Date.parse(started)
  t.mock.method(Date, 'now', () => clock)
  const requested = website(t, [1, 2, 3, 4, 5, 6], () => { clock += 10 })
  const first = await scrapeStock([1, 2, 3, 4, 5, 6].map(previous),
    { refreshStartedAt: started, budgetMs: 25 })
  assert.equal(first.pending, 3)
  assert.equal(first.cars.length, 6)
  assert.equal(first.cars.filter(c => c.price === '26880').length, 3)
  const second = await scrapeStock(first.cars, { refreshStartedAt: started })
  assert.equal(second.pending, 0)
  assert.equal(new Set(requested).size, 6)
  assert.equal(requested.length, 6)
  assert.ok(second.cars.every(c => c.price === '26880'))
})

test('failed cached listings keep their price and report failure; unread new listings remain pending', async t => {
  website(t, [1, 2], () => { throw new Error('offline') })
  const result = await scrapeStock([previous(1)], { refreshStartedAt: started })
  assert.equal(result.failed.length, 2)
  assert.equal(result.pending, 1)
  assert.equal(result.cars[0].price, '27880')
})
