// Builds the repayment photo for each car and keeps it in the private Blob store.
// A new car, a new price, a new first photo, or a change of finance terms makes a new jpeg.
// Work is capped by a time budget so one request stays inside the function limit; the page
// calls back until every car has one.

import { FINANCE, repaymentDisclaimer, termsKey, weeklyFor } from './finance.js'
import { dealerPhotoUrl, photoDecision, renderRepaymentPhoto, summarisePhotos } from './repayment-photo.js'
import { openCarPhoto, readPhotoIndex, updatePhotoIndex, writeCarPhoto } from './store.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 AutozoneWindowCards/1.0 (+https://brokenmind.com.au)'

export async function fetchDealerPhoto(url) {
  const target = dealerPhotoUrl(url)
  const r = await fetch(target, {
    headers: { 'user-agent': UA, accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow'
  })
  if (!r.ok) throw new Error('The listing photo did not load (HTTP ' + r.status + ')')
  const finalHost = new URL(r.url).hostname
  if (finalHost !== 'autozoneqldptyltd.com') throw new Error('The listing photo is not on the Autozone website')
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 1000) throw new Error('The listing photo was empty')
  return buf
}

async function remember(id, entry) {
  await updatePhotoIndex(doc => {
    doc.items ||= {}
    doc.items[id] = entry
  })
}

async function stamp(car) {
  const weekly = weeklyFor(car.price, FINANCE)
  const jpeg = await renderRepaymentPhoto(await fetchDealerPhoto(car.photo), {
    weekly,
    disclaimer: repaymentDisclaimer(FINANCE)
  })
  await writeCarPhoto(car.id, jpeg)
  await remember(car.id, {
    price: String(car.price), source: car.photo, termsKey: termsKey(FINANCE),
    ok: true, at: new Date().toISOString(), attempts: 0
  })
}

/**
 * Generate photos that are out of date, stopping when `budgetMs` is used up.
 * `onlyId` stamps that one car even if earlier attempts failed.
 */
export async function ensureRepaymentPhotos(cars, { budgetMs = 35000, onlyId = null, force = false } = {}) {
  const key = termsKey(FINANCE)
  const started = Date.now()
  const list = cars.filter(c => !onlyId || String(c.id) === String(onlyId))
  for (const car of list) {
    if (Date.now() - started > budgetMs) break
    const index = await readPhotoIndex()
    const decision = photoDecision(car, index.items?.[car.id], key)
    if (decision === 'skip') continue
    if (!force && decision !== 'stale') continue
    try {
      await stamp(car)
    } catch (e) {
      const prev = (await readPhotoIndex()).items?.[car.id] || {}
      await remember(car.id, {
        price: String(car.price || ''), source: car.photo || '', termsKey: key, ok: false,
        error: String(e.message || e).slice(0, 300),
        at: new Date().toISOString(),
        attempts: (prev.attempts || 0) + 1
      })
    }
    if (onlyId) break
  }
  return summarisePhotos(cars, await readPhotoIndex(), key)
}

export async function photoSummary(cars) {
  return summarisePhotos(cars, await readPhotoIndex(), termsKey(FINANCE))
}

export async function readReadyPhoto(id) {
  return openCarPhoto(id)
}
