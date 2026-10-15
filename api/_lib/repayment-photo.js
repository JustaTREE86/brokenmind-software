// Draws one repayment photo: the listing's first picture, a weekly figure, and the disclaimer.
// The figure is dollars per week only. The interest rate stays in the disclaimer sentence.

import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { repaymentDisclaimer } from './finance.js'

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

function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? line + ' ' + word : word
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/**
 * @param {Buffer} imageBuffer the listing's first photo
 * @param {{ weekly: number, disclaimer?: string }} opts
 * @returns {Promise<Buffer>} jpeg
 */
export async function renderRepaymentPhoto(imageBuffer, { weekly, disclaimer } = {}) {
  const amount = Math.round(Number(weekly) || 0)
  if (!amount) throw new Error('No weekly repayment to print')
  const text = disclaimer || repaymentDisclaimer()
  const img = await loadImage(imageBuffer)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)

  const pad = Math.max(16, Math.round(w * 0.028))
  let discSize = Math.max(20, Math.round(w * 0.024))
  const amountSize = Math.max(36, Math.round(h * 0.068))
  const label = '$' + amount.toLocaleString('en-AU') + '/wk'
  ctx.font = '700 ' + amountSize + 'px "Noto Sans Bold"'
  if (ctx.measureText(label).width < 8) throw new Error('Repayment font did not load')

  let lines = []
  let lineH = 0
  let bandH = 0
  for (let attempt = 0; attempt < 6; attempt++) {
    ctx.font = '700 ' + discSize + 'px "Noto Sans Bold"'
    lines = wrap(ctx, text, w - pad * 2)
    lineH = Math.round(discSize * 1.38)
    bandH = pad + Math.round(amountSize * 1.05) + Math.round(discSize * 0.55) + lines.length * lineH + pad
    if (bandH <= h * 0.34 || discSize <= 16) break
    discSize -= 2
  }

  const top = h - bandH
  ctx.fillStyle = INK
  ctx.fillRect(0, top, w, bandH)
  ctx.fillStyle = ORANGE
  ctx.fillRect(0, top, w, Math.max(6, Math.round(h * 0.008)))

  ctx.textBaseline = 'top'
  ctx.fillStyle = '#FFFFFF'
  ctx.font = '700 ' + amountSize + 'px "Noto Sans Bold"'
  const amountY = top + Math.max(10, Math.round(pad * 0.7))
  ctx.fillText(label, pad, amountY)

  ctx.font = '700 ' + discSize + 'px "Noto Sans Bold"'
  ctx.fillStyle = '#FFFFFF'
  let y = amountY + Math.round(amountSize * 1.02) + Math.round(discSize * 0.35)
  for (const line of lines) {
    ctx.fillText(line, pad, y)
    y += lineH
  }

  return canvas.toBuffer('image/jpeg', 90)
}
