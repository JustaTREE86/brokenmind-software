// Draws one repayment photo: the listing's first picture, a weekly figure, and a short disclaimer.
// The figure is dollars per week only. The full disclaimer stays on the window card.
// The dealer's own logo is already on the listing photo, so this does not add another.

import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { photoCaptionLines } from './finance.js'

const fontDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts')
GlobalFonts.registerFromPath(path.join(fontDir, 'NotoSans-Regular.ttf'), 'Noto Sans')
GlobalFonts.registerFromPath(path.join(fontDir, 'NotoSans-Bold.ttf'), 'Noto Sans Bold')

const MAX_EDGE = 1600
const INK = '#0E0E0E'
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

  const label = '$' + amount.toLocaleString('en-AU') + '/wk'
  const amountSize = Math.max(34, Math.round(h * 0.052))
  ctx.font = '700 ' + amountSize + 'px "Noto Sans Bold"'
  if (ctx.measureText(label).width < 8) throw new Error('Repayment font did not load')
  const badge = drawBadge(ctx, w, label, amountSize)
  drawCaption(ctx, w, h, caption, badge)

  return canvas.toBuffer('image/jpeg', 90)
}

function drawBadge(ctx, w, label, amountSize) {
  const margin = Math.max(14, Math.round(w * 0.028))
  const textW = ctx.measureText(label).width
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

  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#FFFFFF'
  ctx.font = '700 ' + amountSize + 'px "Noto Sans Bold"'
  ctx.fillText(label, barX + barW + gap, y + pillH / 2 + Math.round(amountSize * 0.04))
  return { right: x + pillW, bottom: y + pillH }
}

function drawCaption(ctx, w, h, lines, badge) {
  const margin = Math.max(14, Math.round(w * 0.028))
  // Tucked under the weekly badge, top-right. Number plates sit low and centred,
  // so a bottom strip was covering them.
  const maxW = Math.round(w * 0.46)
  let size = Math.max(17, Math.round(w * 0.021))
  const minSize = Math.max(15, Math.round(w * 0.017))
  const fontFor = px => '700 ' + px + 'px "Noto Sans Bold"'
  while (size > minSize) {
    ctx.font = fontFor(size)
    const widest = Math.max(...lines.map(line => ctx.measureText(line).width))
    if (widest <= maxW) break
    size -= 1
  }
  ctx.font = fontFor(size)
  const lineH = Math.round(size * 1.22)
  const padX = Math.round(size * 0.62)
  const padY = Math.round(size * 0.42)
  const textW = Math.min(maxW, Math.max(...lines.map(line => ctx.measureText(line).width)))
  const boxW = Math.round(textW + padX * 2)
  const boxH = Math.round(padY * 2 + lines.length * lineH - Math.round(size * 0.15))
  const x = Math.max(margin, badge.right - boxW)
  const y = badge.bottom + Math.round(margin * 0.45)
  const radius = Math.round(size * 0.55)

  const g = ctx.createLinearGradient(x, y, x, y + boxH)
  g.addColorStop(0, 'rgba(255,255,255,0.62)')
  g.addColorStop(1, 'rgba(255,255,255,0.84)')
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.22)'
  ctx.shadowBlur = Math.round(size * 0.7)
  ctx.shadowOffsetY = Math.round(size * 0.12)
  roundedRect(ctx, x, y, boxW, boxH, radius)
  ctx.fillStyle = g
  ctx.fill()
  ctx.restore()

  ctx.textBaseline = 'top'
  ctx.fillStyle = INK
  ctx.font = fontFor(size)
  let ty = y + padY + Math.round(size * 0.12)
  for (const line of lines) {
    ctx.fillText(line, x + padX, ty)
    ty += lineH
  }
}
