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
 * stale: missing, or the price, source photo or terms have moved
 * failed: the last few attempts failed and nothing has changed since
 * skip: there is nothing to stamp
 */
export function photoDecision(car, entry, key) {
  if (!car?.photo || !car?.price) return 'skip'
  const same = entry && entry.termsKey === key && String(entry.price) === String(car.price) && entry.source === car.photo
  if (same && entry.ok) return 'ready'
  if (same && !entry.ok && (entry.attempts || 0) >= 3) return 'failed'
  return 'stale'
}

export function summarisePhotos(cars, index, key) {
  const byId = {}
  let ready = 0, pending = 0, failed = 0
  for (const car of cars) {
    const d = photoDecision(car, index?.items?.[car.id], key)
    byId[car.id] = d
    if (d === 'ready') ready++
    else if (d === 'failed') failed++
    else if (d === 'stale') pending++
  }
  return { ready, pending, failed, byId }
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
  const maxW = Math.round(w * 0.66)
  let size = Math.max(22, Math.round(w * 0.032))
  const minSize = Math.max(18, Math.round(w * 0.026))
  const fontFor = px => '700 ' + px + 'px "Noto Sans Bold"'
  while (size > minSize) {
    ctx.font = fontFor(size)
    const widest = Math.max(...lines.map(line => ctx.measureText(line).width))
    if (widest <= maxW) break
    size -= 1
  }
  ctx.font = fontFor(size)
  const lineH = Math.round(size * 1.3)
  const padX = Math.round(size * 0.8)
  const padY = Math.round(size * 0.58)
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

  ctx.save()
  roundedRect(ctx, x, y, boxW, boxH, radius)
  ctx.clip()
  ctx.fillStyle = ORANGE
  ctx.fillRect(x, y, boxW, Math.max(3, Math.round(size * 0.14)))
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
