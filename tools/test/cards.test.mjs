import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTitle, reconcile, markPrinted } from '../../api/_lib/cards.js'
import { parseSitemap, parseListing } from '../../api/_lib/scrape.js'

const car = (id, o = {}) => ({ id, url: 'https://autozoneqldptyltd.com/listing/x-' + id + '/', short: 'https://autozoneqldptyltd.com/?p=' + id,
  rawTitle: '2020 Ford Ranger XLS 🔥3-year warranty🔥', price: '27990', odometer: '100000', year: '2020', make: 'Ford', model: 'Ranger XLS',
  transmission: 'Automatic', fuel: 'Diesel', drive: '4WD', engine: '3.2L', doors: '4-door', colour: 'White', vin: 'VIN' + id, warranty: '3-Year Warranty', photo: '', ...o })
const stateWith = (...cars) => {
  const s = { printed: {}, titles: {} }
  markPrinted(s, cars, cars.map(c => c.id), 'Printed')
  s.log = []; s.undo = null
  return s
}

test('cleanTitle strips sales lines and tidies shouting', () => {
  assert.equal(cleanTitle('2019 Isuzu D-max SX 🔥Many After Market Extras Plus 3-year Warranty🔥'), '2019 Isuzu D-max SX')
  assert.equal(cleanTitle('2021 TOYOTA HILUX SRG RUGGED X 4X4'), '2021 Toyota Hilux SRG Rugged X 4x4')
  assert.equal(cleanTitle('2022 MERCEDES-BENZ GLS 400d 4MATIC 🔥3-year Warranty🔥'), '2022 Mercedes-Benz GLS 400d 4MATIC')
  assert.equal(cleanTitle('2016 Mercedes-Benz GLE 250d ✨🎅🏼🎄 CHRISTMAS SPECIAL 🎄🎅🏼✨'), '2016 Mercedes-Benz GLE 250d')
})

test('unchanged card is ok; a few km of test drives is not a reprint', () => {
  const s = stateWith(car('1'))
  assert.equal(reconcile([car('1', { odometer: '100400' })], s).cars[0].status, 'ok')
  const moved = reconcile([car('1', { odometer: '101500' })], s).cars[0]
  assert.equal(moved.status, 'changed')
  assert.match(moved.changes[0], /Kms/)
})

test('price change needs a reprint and says what changed', () => {
  const r = reconcile([car('1', { price: '25990' })], stateWith(car('1'))).cars[0]
  assert.equal(r.status, 'changed')
  assert.deepEqual(r.changes, ['Price $27,990 → $25,990'])
})

test('re-listed car is matched by VIN, not reported sold, and keeps its tidied name', () => {
  const s = stateWith(car('1'))
  s.titles['1'] = '2020 Ford Ranger XLS Hi-Rider'
  const { cars, sold } = reconcile([car('2', { vin: 'VIN1' })], s)
  assert.equal(cars[0].status, 'relisted')
  assert.equal(cars[0].replaces, '1')
  assert.equal(cars[0].title, '2020 Ford Ranger XLS Hi-Rider')
  assert.equal(sold.length, 0)
  markPrinted(s, [car('2', { vin: 'VIN1' })], ['2'], 'Printed')
  assert.ok(!s.printed['1'] && s.printed['2'])
  assert.equal(s.titles['2'], '2020 Ford Ranger XLS Hi-Rider')
  assert.equal(reconcile([car('2', { vin: 'VIN1' })], s).cars[0].status, 'ok')
})

test('re-list without a VIN falls back to year, make, model and kms', () => {
  const s = stateWith(car('1', { vin: '' }))
  assert.equal(reconcile([car('2', { vin: '', odometer: '100900' })], s).cars[0].status, 'relisted')
  assert.equal(reconcile([car('3', { vin: '', odometer: '150000' })], s).cars[0].status, 'new')
})

test('car gone from the website is sold; a brand new car is new', () => {
  const { cars, sold } = reconcile([car('9', { vin: 'OTHER' })], stateWith(car('1')))
  assert.equal(cars[0].status, 'new')
  assert.deepEqual(sold.map(s => s.id), ['1'])
})

test('second listing for a car that already has a card is flagged as a likely duplicate', () => {
  const s = stateWith(car('1'))
  const { cars } = reconcile([car('1'), car('2', { vin: 'VIN1' })], s)
  const dup = cars.find(c => c.id === '2')
  assert.equal(dup.status, 'new')
  assert.equal(dup.duplicateOf, '1')
})

test('undo information restores the previous card', () => {
  const s = stateWith(car('1'))
  const before = structuredClone(s.printed['1'])
  markPrinted(s, [car('1', { price: '1' })], ['1'], 'Printed')
  assert.equal(s.printed['1'].price, '1')
  assert.deepEqual(s.undo.printed['1'], before)
})

test('sitemap and listing parsing', () => {
  const xml = '<urlset><url><loc>https://autozoneqldptyltd.com/search/</loc></url>' +
    '<url><loc>https://autozoneqldptyltd.com/listing/a/</loc><lastmod>2026-09-11T06:02:37+00:00</lastmod></url>' +
    '<url><loc>https://autozoneqldptyltd.com/listing/a/</loc></url></urlset>'
  assert.deepEqual(parseSitemap(xml), [{ url: 'https://autozoneqldptyltd.com/listing/a/', lastmod: '2026-09-11T06:02:37+00:00' }])
  const html = `<link rel='shortlink' href='https://autozoneqldptyltd.com/?p=30046' />
    <meta property="og:image" content="https://x/y.jpg"/><div class="vehica-car-name">2023 Ford Ranger Raptor 3.0 4x4 &#x1f525;</div>
    <div class="vehica-car-price">  $69,990  </div>
    <div class="vehica-car-attributes__name vehica-grid__element--1of2">Mileage: </div><div class="vehica-car-attributes__values x">57,894km </div>
    <div class="vehica-car-attributes__name">Make:</div><div class="vehica-car-attributes__values">Ford</div> 3-year Warranty`
  const c = parseListing('https://autozoneqldptyltd.com/listing/a/', html)
  assert.equal(c.id, '30046'); assert.equal(c.price, '69990'); assert.equal(c.odometer, '57894')
  assert.equal(c.make, 'Ford'); assert.equal(c.warranty, '3-Year Warranty'); assert.equal(c.photo, 'https://x/y.jpg')
  assert.equal(cleanTitle(c.rawTitle), '2023 Ford Ranger Raptor 3.0 4x4')
})

test('studio names stick to their own listing; staff fixes follow a re-list with the year kept right', () => {
  const s = stateWith(car('1'))
  s.seedTitles = { '1': '2020 Ford Ranger XLS Studio' }
  s.printed['1'].title = '2020 Ford Ranger XLS Studio'
  assert.equal(reconcile([car('1')], s).cars[0].status, 'ok', 'studio name matches its printed card')
  const relist = reconcile([car('2', { vin: 'VIN1', rawTitle: '2020 Ford Ranger XLS Hi-Rider 🔥' })], s).cars[0]
  assert.equal(relist.title, '2020 Ford Ranger XLS Hi-Rider', 'the website name wins on a new listing')

  const t = stateWith(car('1'))
  t.titles['1'] = '2019 Ford Ranger XLS (staff)'
  const moved = reconcile([car('2', { vin: 'VIN1' })], t).cars[0]
  assert.equal(moved.title, '2020 Ford Ranger XLS (staff)')
})
