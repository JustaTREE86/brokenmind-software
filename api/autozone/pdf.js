// GET /api/autozone/pdf?ids=30046,30075[&mark=1]
// Prints window cards to PDF through the card engine (the Card Studio's own renderer) in headless
// Chrome: the same path the Card Studio's print script uses, so the output is identical.
// The car details come from the website sync on the server, never from the browser, so the
// price and finance figures on a card can't be edited by whoever is downloading it.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { staffOnly, send } from '../_lib/http.js'
import { readCompleteStock, readState, updateState } from '../_lib/store.js'
import { reconcile, markPrinted } from '../_lib/cards.js'

const ENGINE = path.join(process.cwd(), 'autozone', 'engine.html')
const LOCAL_CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

async function launch() {
  const puppeteer = (await import('puppeteer-core')).default
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return puppeteer.launch({ executablePath: LOCAL_CHROME, headless: true })
  }
  const chromium = (await import('@sparticuz/chromium')).default
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
    executablePath: await chromium.executablePath(),
    headless: 'shell'
  })
}

// JSON that is safe to drop inside a <script> tag
const scriptJson = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const fileName = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()

export default staffOnly(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(id => /^\d{1,10}$/.test(id))
  if (!ids.length) return send(res, 400, { error: 'No cars chosen' })

  const [stock, state] = await Promise.all([readCompleteStock(), readState()])
  const { cars } = reconcile(stock.cars, state)
  const chosen = ids.map(id => cars.find(c => c.id === id)).filter(Boolean)
  if (!chosen.length) return send(res, 404, { error: 'Those cars are no longer on the website' })

  const engine = readFileSync(ENGINE, 'utf8')
  // exactly the card the preview showed (same name), minus the app-only fields
  const data = chosen.map(({ rawTitle, photo, status, changes, replaces, printedAt, titleEdited, duplicateOf, ...card }) => card)
  // The studio file opens with its charset tag (no <head>); the data goes straight after it.
  const inject = '<script>window.AZ_CARS=' + scriptJson(data) + '</script>'
  const html = /<meta charset=[^>]*>/i.test(engine) ? engine.replace(/<meta charset=[^>]*>/i, m => m + inject) : inject + engine

  const browser = await launch()
  let pdf
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1123, height: 794 })
    // the card fonts come from Google Fonts, so let the network settle before printing
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 })
    await page.evaluate(() => document.fonts.ready)
    const rendered = await page.$$eval('#printArea .card', els => els.length)
    if (rendered !== data.length) throw new Error('The card engine rendered ' + rendered + ' of ' + data.length + ' cards')
    pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  } finally {
    await browser.close()
  }

  if (req.query.mark === '1') await updateState(s => markPrinted(s, stock.cars, chosen.map(c => c.id), 'Downloaded'))

  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' })
  const name = chosen.length === 1 ? fileName(chosen[0].title) : `Autozone window cards ${date} (${chosen.length})`
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`)
  res.setHeader('Cache-Control', 'no-store')
  res.end(Buffer.from(pdf))
})
