// Reads the current stock straight off autozoneqldptyltd.com.
//
// Autozone runs WordPress with the Vehica theme. Its public inventory feed discovers cars;
// the sitemap can omit new stock. Each listing page carries the price, the spec table, a `?p=ID` short link
// (what the window-card QR points at) and the main photo. Nothing here needs a login or an API.

const SITE = 'https://autozoneqldptyltd.com'
const INVENTORY = SITE + '/wp-json/vehica/v1/cars'
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
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xml,application/json' },
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
  const gallery = parseGallery(h)
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
    photo: one(/property="og:image"\s*content="([^"]+)"/) || gallery[0] || '',
    gallery,
    galleryKey: galleryKey(gallery)
  }
}

/** Full-size listing photos, in gallery order. Resized copies (-300x225) are left out. */
export function parseGallery(html) {
  const seen = new Set()
  const out = []
  const add = raw => {
    let u
    try { u = new URL(decode(raw)) } catch { return }
    if (u.protocol !== 'https:' || u.hostname !== 'autozoneqldptyltd.com') return
    if (!/\/wp-content\/uploads\//.test(u.pathname)) return
    if (/-\d+x\d+\.(jpe?g|png|webp)$/i.test(u.pathname)) return
    const s = u.toString()
    if (seen.has(s)) return
    seen.add(s)
    out.push(s)
  }
  for (const m of String(html || '').matchAll(/data-src="(https:\/\/autozoneqldptyltd\.com\/wp-content\/uploads\/[^"]+)"/g)) add(m[1])
  if (!out.length) {
    for (const m of String(html || '').matchAll(/property="og:image"\s+content="([^"]+)"/g)) add(m[1])
  }
  return out
}

/** Short fingerprint of the gallery, so a new upload is stamped and an old one is not. */
export function galleryKey(urls) {
  return (urls || []).join('\n')
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

/** Require a complete inventory before reconciling sold cars. Partial feeds must never remove stock. */
export function parseInventory(body) {
  const data = JSON.parse(body)
  if (!Number.isInteger(data.resultsCount) || data.resultsCount <= 0 || !Array.isArray(data.results))
    throw new Error('The Autozone inventory feed did not return a complete stock list')
  const entries = new Map()
  for (const car of data.results) {
    const url = new URL(car.url)
    if (url.origin !== SITE || !url.pathname.startsWith('/listing/') || url.search || url.hash)
      throw new Error('The Autozone inventory feed returned an invalid listing URL')
    entries.set(url.href, { url: url.href, lastmod: '' })
  }
  if (entries.size !== data.resultsCount)
    throw new Error('The Autozone inventory feed returned only part of the stock list')
  return [...entries.values()]
}

/**
 * The sitemap's lastmod can stay unchanged after a price edit, so every sync reads every listing.
 * Anything not re-read keeps its previous details, and a listing that fails to load is reported in
 * `failed` rather than dropped, so a flaky request can never make a car look sold. `budgetMs` stops
 * a first-ever sync running past the function time limit; the rest is picked up by the next sync.
 */
export async function scrapeStock(prev = [], { budgetMs = 40000, refreshStartedAt = new Date().toISOString() } = {}) {
  const started = Date.now()
  const entries = parseInventory(await fetchText(INVENTORY))

  const old = new Map(prev.map(c => [c.url, c]))
  // The dealer changes prices without updating sitemap lastmod. Check every listing once
  // per refresh, resuming the same refresh across requests when the time budget runs out.
  const toFetch = entries.filter(e => {
    const previous = old.get(e.url)
    return !previous || previous.lastmod !== e.lastmod ||
      !(Date.parse(previous.fetchedAt) >= Date.parse(refreshStartedAt))
  })

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
  const failedUrls = new Set(failed.map(e => e.url))
  const pending = toFetch.filter(e => !fresh.has(e.url) &&
    !(failedUrls.has(e.url) && old.has(e.url))).length
  return { cars, failed, listed: entries.length, fetched: fresh.size, pending }
}
