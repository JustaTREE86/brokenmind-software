import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import {
  FINANCE, weeklyFor, repaymentDisclaimer, termsKey, num
} from '../../api/_lib/finance.js'
import { patchEngineFinance } from '../patch-engine-finance.mjs'
import {
  dealerPhotoUrl, photoDecision, renderRepaymentPhoto, repaymentFileName, summarisePhotos
} from '../../api/_lib/repayment-photo.js'
import { parseListing } from '../../api/_lib/scrape.js'

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const enginePath = path.join(root, 'autozone', 'engine.html')
const EXPECTED = 'Weekly repayment is an estimate only, based on 20% deposit, 9.49% p.a. over 84 months with $900 fees financed and no balloon. Excludes government charges. Subject to lending criteria, fees and charges apply. Not a quote or offer of finance.'

function engineApi() {
  const html = readFileSync(enginePath, 'utf8')
  const take = name => {
    const start = html.indexOf('function ' + name + '(')
    let i = html.indexOf('{', start), depth = 0
    for (; i < html.length; i++) {
      if (html[i] === '{') depth++
      else if (html[i] === '}') { depth--; if (depth === 0) { i++; break } }
    }
    return html.slice(start, i)
  }
  const defStart = html.indexOf('var DEF = {')
  const defEnd = html.indexOf('var S = load()')
  const src = take('num') + '\n' + take('money') + '\n' + html.slice(defStart, defEnd) +
    '\nvar S = DEF;\n' + take('weeklyFor') + '\n' + take('disclaimer') +
    '\nreturn { weeklyFor, disclaimer, DEF }'
  return new Function(src)()
}

test('shared terms are the card engine settings', () => {
  assert.deepEqual(
    { dep: FINANCE.dep, rate: FINANCE.rate, term: FINANCE.term, fee: FINANCE.fee, balloon: FINANCE.balloon, round: FINANCE.round, showRate: FINANCE.showRate },
    { dep: 20, rate: 9.49, term: 84, fee: 900, balloon: 0, round: 1, showRate: false }
  )
  assert.equal(repaymentDisclaimer(), EXPECTED)
  assert.equal(termsKey(), '20|9.49|84|900|0|1')
  assert.equal(weeklyFor(0), 0)
  assert.equal(weeklyFor('27,880'), 87)
  assert.equal(weeklyFor(9880), 33)
  assert.equal(weeklyFor(16880), 54)
  assert.equal(weeklyFor(49880), 154)
  assert.equal(weeklyFor(99880), 305)
})

test('a balloon or a different fee changes the disclaimer from the same place', () => {
  const text = repaymentDisclaimer({ ...FINANCE, balloon: 2000, fee: 1200, dep: 10, rate: 8.5, term: 60 })
  assert.match(text, /10% deposit, 8\.5% p\.a\. over 60 months with \$1,200 fees financed and a \$2,000 balloon/)
  assert.equal(weeklyFor(20000, { ...FINANCE, rate: 0, balloon: 0, fee: 0, dep: 0, term: 52, round: 1 }), 89)
})

test('the generated card engine uses the shared terms and always prints the disclaimer', () => {
  const html = readFileSync(enginePath, 'utf8')
  const patched = patchEngineFinance(html)
  assert.equal(patched, html, 'run npm run engine so the card picks up api/_lib/finance.js')
  assert.equal(patchEngineFinance(patched), patched)

  const api = engineApi()
  assert.equal(api.DEF.dep, FINANCE.dep)
  assert.equal(api.DEF.rate, FINANCE.rate)
  assert.equal(api.DEF.term, FINANCE.term)
  assert.equal(api.DEF.fee, FINANCE.fee)
  assert.equal(api.DEF.balloon, FINANCE.balloon)
  assert.equal(api.DEF.showRate, false)
  for (const price of [9880, 22990, 27880, 69990, 99880]) {
    assert.equal(api.weeklyFor(price), weeklyFor(price), 'card weeklyFor for ' + price)
  }
  const plain = api.disclaimer(27880, 87, '')
  assert.equal(plain.startsWith(EXPECTED), true)
  assert.match(plain, /564090/)
  assert.doesNotMatch(plain, /3-Year Warranty refers/)
  const withWarranty = api.disclaimer(27880, 87, '3-Year Warranty')
  assert.equal(withWarranty.startsWith(EXPECTED), true)
  assert.match(withWarranty, /3-Year Warranty refers to a mechanical breakdown warranty/)
  assert.match(html, /function partFooter\(m, w\)\{\s*return '<div class="ft2">'\s*\+\s*'<div class="disc">'/)
  assert.equal(html.includes("partFooter(m, w)"), true)
  assert.doesNotMatch(html.slice(html.indexOf('function partWeekly'), html.indexOf('function partFooter')), /S\.rate/)
  assert.equal(num('9.49'), 9.49)
})

test('photo regeneration follows price, picture and terms', () => {
  const car = { id: '5', price: '27880', photo: 'https://autozoneqldptyltd.com/wp-content/a.jpg' }
  const key = termsKey()
  const entry = { price: '27880', source: car.photo, termsKey: key, ok: true, attempts: 0 }
  assert.equal(photoDecision(car, null, key), 'stale')
  assert.equal(photoDecision(car, entry, key), 'ready')
  assert.equal(photoDecision({ ...car, price: '25000' }, entry, key), 'stale')
  assert.equal(photoDecision({ ...car, photo: 'https://autozoneqldptyltd.com/wp-content/b.jpg' }, entry, key), 'stale')
  assert.equal(photoDecision(car, entry, '20|9.5|84|900|0|1'), 'stale')
  assert.equal(photoDecision(car, { ...entry, ok: false, attempts: 2 }, key), 'stale')
  assert.equal(photoDecision(car, { ...entry, ok: false, attempts: 3 }, key), 'failed')
  assert.equal(photoDecision({ id: '6', price: '', photo: '' }, null, key), 'skip')
  const summary = summarisePhotos(
    [car, { id: '6', price: '1', photo: 'https://autozoneqldptyltd.com/x.jpg' }],
    { items: { '5': entry } },
    key
  )
  assert.equal(summary.ready, 1)
  assert.equal(summary.pending, 1)
  assert.equal(dealerPhotoUrl(car.photo), car.photo)
  assert.throws(() => dealerPhotoUrl('https://evil.example/a.jpg'), /Autozone website/)
  assert.equal(repaymentFileName({ year: '2020', make: 'Ford', model: 'Ranger XLS' }), '2020-ford-ranger-xls-repayment.jpg')
})

test('the badge is dollars per week plus a readable disclaimer, and the photo stays visible', async () => {
  const src = createCanvas(900, 600)
  const sctx = src.getContext('2d')
  sctx.fillStyle = '#1d4ed8'
  sctx.fillRect(0, 0, 900, 600)
  sctx.fillStyle = '#f8fafc'
  sctx.fillRect(400, 470, 120, 36)
  const jpeg = await renderRepaymentPhoto(src.toBuffer('image/jpeg', 90), { weekly: 87, disclaimer: EXPECTED })
  assert.equal(jpeg[0], 0xff)
  assert.equal(jpeg[1], 0xd8)
  writeFileSync('/tmp/az-photo-fixture.jpg', jpeg)

  const img = await loadImage(jpeg)
  assert.equal(img.width, 900)
  assert.equal(img.height, 600)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const top = ctx.getImageData(20, 20, 1, 1).data
  assert.ok(top[2] > top[0] + 40, 'the top of the photo is still the car, not the badge')
  const foot = ctx.getImageData(20, 590, 1, 1).data
  assert.ok(foot[0] < 40 && foot[1] < 40 && foot[2] < 40, 'disclaimer sits on a dark band')

  const pixels = ctx.getImageData(0, 0, img.width, img.height).data
  let orange = 0, light = 0
  for (let i = 0; i < pixels.length; i += 16) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
    if (r > 200 && g > 70 && g < 190 && b < 90) orange++
    if (r > 220 && g > 220 && b > 220) light++
  }
  assert.ok(orange > 20, 'orange Autozone rule is drawn')
  assert.ok(light > 30, 'the weekly figure and disclaimer are light on the band')
  const band = ctx.getImageData(0, 430, 900, 170).data
  let bandLight = 0
  for (let y = 0; y < 170; y += 2) {
    let row = 0
    for (let x = 0; x < 900; x += 2) {
      const i = (y * 900 + x) * 4
      if (band[i] > 210 && band[i + 1] > 210 && band[i + 2] > 210) row++
    }
    if (row > 8) bandLight++
  }
  assert.ok(bandLight >= 4, 'disclaimer wraps onto more than one readable line')
})

test('a real Autozone listing photo is stamped with that car\'s repayment', { timeout: 60000 }, async () => {
  const url = 'https://autozoneqldptyltd.com/listing/2022-mazda-cx-5-maxx-sport-fwd/'
  const html = await fetch(url, { signal: AbortSignal.timeout(20000) }).then(r => r.text())
  const car = parseListing(url, html)
  assert.equal(car.price, '22990')
  assert.match(car.photo, /^https:\/\/autozoneqldptyltd\.com\//)
  const weekly = weeklyFor(car.price)
  assert.equal(weekly, 73)
  const bytes = Buffer.from(await fetch(car.photo, { signal: AbortSignal.timeout(20000) }).then(r => r.arrayBuffer()))
  const jpeg = await renderRepaymentPhoto(bytes, { weekly, disclaimer: repaymentDisclaimer() })
  const out = '/tmp/az-photo-mazda.jpg'
  writeFileSync(out, jpeg)
  const img = await loadImage(jpeg)
  assert.ok(img.width >= 1200 && img.width <= 1600)
  assert.ok(jpeg.length > 40000)
  assert.ok(existsSync(out))
})

test('the window card still renders the price, the weekly figure and the disclaimer', { timeout: 60000 }, async (t) => {
  const chrome = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].find(p => existsSync(p))
  if (!chrome) return t.skip('Chrome is not installed')
  const puppeteer = (await import('puppeteer-core')).default
  const car = {
    id: '1', url: 'https://autozoneqldptyltd.com/listing/x/', short: 'https://autozoneqldptyltd.com/?p=1',
    title: 'Ford Ranger XLS', price: '27880', odometer: '100000', year: '2020', make: 'Ford', model: 'Ranger XLS',
    transmission: 'Automatic', fuel: 'Diesel', drive: '4WD', engine: '3.2L', doors: '4', colour: 'White',
    vin: 'VIN1', warranty: '3-Year Warranty'
  }
  const engine = readFileSync(enginePath, 'utf8')
  const inject = '<script>window.AZ_CARS=' + JSON.stringify([car]) + '</script>'
  const html = engine.replace(/<meta charset=[^>]*>/i, m => m + inject)
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 })
    const text = await page.$eval('.disc', el => el.textContent)
    assert.equal(text.startsWith(EXPECTED), true)
    assert.match(text, /3-Year Warranty refers to a mechanical breakdown warranty/)
    assert.match(text, /564090/)
    const weekly = await page.$eval('.wk .big', el => el.textContent.replace(/\s+/g, ''))
    assert.equal(weekly, '$87*')
    const price = await page.$eval('.pblock .amt', el => el.textContent)
    assert.equal(price, '$27,880')
    assert.equal(await page.$eval('.card', el => el.className.includes('land')), true)
    const card = await page.$('.card')
    await card.screenshot({ path: '/tmp/az-card.png' })
  } finally {
    await browser.close()
  }
})
