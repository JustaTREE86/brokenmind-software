// Reads the current stock straight off autozoneqldptyltd.com.
//
// Autozone runs WordPress with the Vehica theme. Every car is a `vehica_car` post: the sitemap
// lists them all, and each listing page carries the price, the spec table, a `?p=ID` short link
// (what the window-card QR points at) and the main photo. Nothing here needs a login or an API.

const SITE = 'https://autozoneqldptyltd.com'
const SITEMAP = SITE + '/vehica_car-sitemap.xml'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 AutozoneWindowCards/1.0 (+https://brokenmind.com.au)'

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-',
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...', times: 'x', prime: "'", Prime: '"' }

export function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n] ?? m)
}
const clean = s => decode(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

async function fetchText(url, timeoutMs = 15000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xml' },
        signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return await r.text()
    } catch (e) {
      if (attempt === 1) throw new Error(url + ': ' + e.message)
    }
  }
}

export function parseListing(url, h) {
  const one = re => { const m = h.match(re); return m ? m[1] : '' }
  const attrs = {}
  const re = /vehica-car-attributes__name[^>]*>([\s\S]*?)<\/div>[\s\S]*?vehica-car-attributes__values[^>]*>([\s\S]*?)<\/div>/g
  for (let m; (m = re.exec(h));) {
    const k = clean(m[1]).replace(/:$/, '')
    if (k && !(k in attrs)) attrs[k] = clean(m[2])
  }
  const short = one(/rel=['"]shortlink['"] href=['"]([^'"]+)['"]/)
  const id = (short.match(/[?&]p=(\d+)/) || [])[1] || ''
  return {
    id,
    url,
    short: short || url,
    rawTitle: clean(one(/<div class="vehica-car-name">([\s\S]*?)<\/div>/)),
    price: (one(/<div class="vehica-car-price">\s*\$?([\d,]+)/) || '').replace(/,/g, ''),
    odometer: (attrs['Mileage'] || '').replace(/\D/g, ''),
    year: attrs['Year'] || '',
    make: attrs['Make'] || '',
    model: attrs['Model'] || '',
    transmission: attrs['Transmission'] || '',
    fuel: attrs['Fuel Type'] || '',
    drive: attrs['Drive Type'] || '',
    engine: attrs['Engine Size'] || '',
    doors: attrs['Doors'] || '',
    colour: attrs['Colour'] || '',
    vin: attrs['VIN'] || '',
    warranty: /3[\s-]*year\s*warranty/i.test(h) ? '3-Year Warranty' : '',
    photo: one(/property="og:image"\s*content="([^"]+)"/)
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

/** Listing URLs with their last-modified dates, in sitemap order. */
export function parseSitemap(xml) {
  const seen = new Set(), out = []
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const url = (m[1].match(/<loc>(https:\/\/autozoneqldptyltd\.com\/listing\/[^<]+)<\/loc>/) || [])[1]
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ url, lastmod: (m[1].match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1] || '' })
  }
  return out
}

const AGE_REFRESH_MS = 24 * 3600 * 1000   // re-read an unchanged listing at least daily
const AGE_REFRESH_PER_SYNC = 4            // ...a few at a time, so no single sync is slow

/**
 * The website is slow (about 1.5s a page, slower when asked for several at once), so a sync only
 * re-reads listings the sitemap says have changed since last time, plus a few of the oldest reads.
 * Anything not re-read keeps its previous details, and a listing that fails to load is reported in
 * `failed` rather than dropped, so a flaky request can never make a car look sold. `budgetMs` stops
 * a first-ever sync running past the function time limit; the rest is picked up by the next sync.
 */
export async function scrapeStock(prev = [], { budgetMs = 40000 } = {}) {
  const started = Date.now()
  const entries = parseSitemap(await fetchText(SITEMAP))
  if (!entries.length) throw new Error('The Autozone sitemap listed no cars')

  const old = new Map(prev.map(c => [c.url, c]))
  const stale = e => { const o = old.get(e.url); return !o || o.lastmod !== e.lastmod }
  const aged = entries.filter(e => !stale(e))
    .sort((a, b) => Date.parse(old.get(a.url).fetchedAt || 0) - Date.parse(old.get(b.url).fetchedAt || 0))
    .filter(e => Date.now() - Date.parse(old.get(e.url).fetchedAt || 0) > AGE_REFRESH_MS)
    .slice(0, AGE_REFRESH_PER_SYNC)
  const toFetch = entries.filter(stale).concat(aged)

  const failed = [], fresh = new Map()
  await pool(toFetch, 4, async e => {
    if (Date.now() - started > budgetMs) return
    try {
      const car = parseListing(e.url, await fetchText(e.url))
      if (!car.id || !car.price) throw new Error('no price or listing id on the page')
      fresh.set(e.url, { ...car, lastmod: e.lastmod, fetchedAt: new Date().toISOString() })
    } catch (err) { failed.push({ url: e.url, error: err.message }) }
  })

  // Listings that weren't re-read (unchanged, failed or out of time) keep what we knew.
  const cars = entries.map(e => fresh.get(e.url) || old.get(e.url)).filter(Boolean)
  return { cars, failed, listed: entries.length, fetched: fresh.size, pending: entries.length - cars.length }
}
