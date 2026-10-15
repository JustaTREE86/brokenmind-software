// Draws one repayment photo: the listing's first picture, a weekly figure, and one line of fine print.
// The figure is "From $X/wk" in the top-right. The fine print sits in the bottom
// corner that stays clearest of the car and the number plate. The full disclaimer stays on the window card.
// The dealer's own logo is already on the listing photo, so this does not add another.

import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { photoCaptionLines } from './finance.js'

const fontDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts')
GlobalFonts.registerFromPath(path.join(fontDir, 'NotoSans-Regular.ttf'), 'Noto Sans')
GlobalFonts.registerFromPath(path.join(fontDir, 'NotoSans-Bold.ttf'), 'Noto Sans Bold')

const MAX_EDGE = 1600
const ORANGE = '#F47B20'

export function dealerPhotoUrl(url) {
  let u
  try { u = new URL(String(url || '')) }
  catch { throw new Error('That listing has no photo') }
  if (u.protocol !== 'https:' || u.hostname !== 'autozoneqldptyltd.com')
    throw new Error('That listing photo is not on the Autozone website')
  return u.toString()
}

export function repaymentFileName(car) {
  const parts = [car.year, car.make, car.model].filter(Boolean).join(' ')
  const base = (parts || car.title || 'car').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return (base || 'car') + '-repayment.jpg'
}

/**
 * ready: the stored photo still matches this car and the current terms
 * needsClean: every gallery photo already has a price painted on it, so nothing is stamped
 * stale: missing, or the price, featured photo, gallery or terms have moved
 * failed: the last few attempts failed and nothing has changed since
 * skip: there is nothing to stamp
 */
export function photoDecision(car, entry, key) {
  if (!car?.photo || !car?.price) return 'skip'
  const samePrice = entry && entry.termsKey === key && String(entry.price) === String(car.price)
  const sameGallery = !car.galleryKey || !entry?.galleryKey || entry.galleryKey === car.galleryKey
  const sameFeatured = entry && (entry.featured === car.photo || (!entry.featured && entry.source === car.photo))
  const same = samePrice && sameFeatured && sameGallery
  if (same && entry.needsClean) return 'needsClean'
  if (same && entry.ok && entry.source) return 'ready'
  if (same && !entry.ok && !entry.needsClean && (entry.attempts || 0) >= 3) return 'failed'
  return 'stale'
}

/**
 * The dealer's marketing card is a file named like `34pw` (per week) and a solid
 * orange repayment block in the bottom-right. Measured across the whole yard:
 * those cards are about a third orange in that corner, and a plain photo is under 2%.
 */
export function isPriceCardName(url) {
  let name = ''
  try { name = decodeURIComponent(new URL(String(url)).pathname.split('/').pop() || '') }
  catch { name = String(url || '').split('/').pop() || '' }
  return /(?:^|[^a-z0-9])\d+\s*pw(?:[^a-z0-9]|$)/i.test(name)
}

export async function hasPriceOverlay(imageBuffer) {
  const img = await loadImage(imageBuffer)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const w = img.width, h = img.height
  const x0 = Math.round(w * 0.62), y0 = Math.round(h * 0.62)
  const data = ctx.getImageData(x0, y0, w - x0, h - y0).data
  let n = 0, hit = 0
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    n++
    if (r > 180 && g > 60 && g < 180 && b < 90 && r > g + 40) hit++
  }
  return n > 0 && hit / n > 0.12
}

/** First gallery url that is not a marketing card. `painted` is a set of urls already checked. */
export function nextCleanUrl(urls, painted) {
  for (const url of urls || []) {
    if (!url || isPriceCardName(url)) continue
    if (painted && painted.has(url)) continue
    return url
  }
  return ''
}

export function summarisePhotos(cars, index, key) {
  const byId = {}
  let ready = 0, pending = 0, failed = 0, needsClean = 0
  for (const car of cars) {
    const d = photoDecision(car, index?.items?.[car.id], key)
    byId[car.id] = d
    if (d === 'ready') ready++
    else if (d === 'needsClean') needsClean++
    else if (d === 'failed') failed++
    else if (d === 'stale') pending++
  }
  return { ready, pending, failed, needsClean, byId }
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/**
 * @param {Buffer} imageBuffer the listing's first photo
 * @param {{ weekly: number, lines?: string[] }} opts
 * @returns {Promise<Buffer>} jpeg
 */
export async function renderRepaymentPhoto(imageBuffer, { weekly, lines } = {}) {
  const amount = Math.round(Number(weekly) || 0)
  if (!amount) throw new Error('No weekly repayment to print')
  const caption = (lines && lines.length ? lines : photoCaptionLines()).map(s => String(s))
  const img = await loadImage(imageBuffer)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)

  const amountSize = Math.max(34, Math.round(h * 0.052))
  ctx.font = '700 ' + amountSize + 'px "Noto Sans Bold"'
  if (ctx.measureText(weeklyBadgeText(amount)).width < 8) throw new Error('Repayment font did not load')
  drawBadge(ctx, w, amount, amountSize)
  drawCaption(ctx, w, h, caption)

  return canvas.toBuffer('image/jpeg', 90)
}

/** Photo badge wording. The window card keeps the figure on its own. */
export function weeklyBadgeText(amount) {
  const n = Math.round(Number(amount) || 0)
  return 'From $' + n.toLocaleString('en-AU') + '/wk'
}

function drawBadge(ctx, w, amount, amountSize) {
  const figure = '$' + Math.round(Number(amount) || 0).toLocaleString('en-AU') + '/wk'
  const fromSize = Math.max(15, Math.round(amountSize * 0.58))
  ctx.font = '700 ' + amountSize + 'px "Noto Sans Bold"'
  const figureW = ctx.measureText(figure).width
  ctx.font = '400 ' + fromSize + 'px "Noto Sans"'
  const fromW = ctx.measureText('From').width
  const wordGap = Math.round(amountSize * 0.2)
  const margin = Math.max(14, Math.round(w * 0.028))
  const textW = fromW + wordGap + figureW
  const padX = Math.round(amountSize * 0.55)
  const padY = Math.round(amountSize * 0.32)
  const barW = Math.max(5, Math.round(amountSize * 0.12))
  const gap = Math.round(amountSize * 0.28)
  const pillW = Math.round(padX + barW + gap + textW + padX)
  const pillH = Math.round(amountSize + padY * 2)
  const x = w - margin - pillW
  const y = margin
  const radius = Math.round(pillH / 2)

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = Math.round(pillH * 0.28)
  ctx.shadowOffsetY = Math.round(pillH * 0.08)
  roundedRect(ctx, x, y, pillW, pillH, radius)
  ctx.fillStyle = 'rgba(14,14,14,0.74)'
  ctx.fill()
  ctx.restore()

  const barH = Math.round(pillH * 0.42)
  const barX = x + padX
  const barY = y + (pillH - barH) / 2
  roundedRect(ctx, barX, barY, barW, barH, barW / 2)
  ctx.fillStyle = ORANGE
  ctx.fill()

  const mid = y + pillH / 2 + Math.round(amountSize * 0.04)
  const textX = barX + barW + gap
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,0.82)'
  ctx.font = '400 ' + fromSize + 'px "Noto Sans"'
  ctx.fillText('From', textX, mid)
  ctx.fillStyle = '#FFFFFF'
  ctx.font = '700 ' + amountSize + 'px "Noto Sans Bold"'
  ctx.fillText(figure, textX + fromW + wordGap, mid)
  return { right: x + pillW, bottom: y + pillH }
}

function drawCaption(ctx, w, h, lines) {
  const text = lines.join(' ')
  const margin = Math.max(8, Math.round(w * 0.012))
  let size = Math.max(12, Math.round(h * 0.018))
  const fontFor = px => '700 ' + px + 'px "Noto Sans Bold"'
  ctx.font = fontFor(size)
  let textW = ctx.measureText(text).width
  while (textW > w - margin * 4 && size > 11) {
    size -= 1
    ctx.font = fontFor(size)
    textW = ctx.measureText(text).width
  }
  const padX = Math.max(4, Math.round(size * 0.45))
  const stripH = Math.max(size + 2, Math.round(size * 1.15))
  const stripW = Math.round(Math.min(w - margin * 2, textW + padX * 2))
  const side = clearerCorner(ctx, w, h, stripW)
  const x = side === 'right' ? w - margin - stripW : margin
  const y = h - stripH
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
  ctx.fillRect(x, y, stripW, stripH)
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'
  ctx.shadowBlur = 1
  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'middle'
  ctx.font = fontFor(size)
  ctx.fillText(text, x + padX, y + stripH / 2 + 0.5)
  ctx.restore()
}

function clearerCorner(ctx, w, h, stripW) {
  const sampleH = Math.max(8, Math.round(h * 0.16))
  const y = h - sampleH
  const span = Math.min(stripW, Math.round(w * 0.42))
  const left = plateLikelihood(ctx, 0, y, span, sampleH)
  const right = plateLikelihood(ctx, w - span, y, span, sampleH)
  return right + 0.03 < left ? 'right' : 'left'
}

function plateLikelihood(ctx, x, y, w, h) {
  const data = ctx.getImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h)).data
  let light = 0
  let n = 0
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    n++
    const spread = Math.max(r, g, b) - Math.min(r, g, b)
    if (r > 150 && g > 150 && b > 135 && spread < 45) light++
  }
  return n ? light / n : 0
}
