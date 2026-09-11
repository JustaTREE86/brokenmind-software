// Login lockout: 5 wrong passwords from one address within 15 minutes locks that address out for
// 15 minutes. While locked, the password isn't even checked, so guessing can't carry on.
// Addresses are stored hashed, never as raw IPs.
//
// Staff in one office share an address, so one person's five typos lock the office out for 15
// minutes. That's the trade for a short password on the open internet.

import { createHash } from 'node:crypto'

export const MAX_FAILS = 5
export const WINDOW_MS = 15 * 60 * 1000
export const LOCK_MS = 15 * 60 * 1000

/** Vercel sets x-real-ip / x-forwarded-for itself (clients can't spoof them there). */
export function clientKey(req) {
  const h = req.headers || {}
  const ip = h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) || 'unknown'
  return createHash('sha256').update('azcards-login|' + ip).digest('hex').slice(0, 32)
}

/** Milliseconds until this address may try again (0 if not locked). */
export function lockedFor(rec, now) {
  return rec && rec.lockedUntil && rec.lockedUntil > now ? rec.lockedUntil - now : 0
}

/** The record after one more wrong password. */
export function afterFail(rec, now) {
  const fails = ((rec && rec.fails) || []).filter(t => now - t < WINDOW_MS).concat(now)
  return fails.length >= MAX_FAILS ? { fails: [], lockedUntil: now + LOCK_MS } : { fails }
}

export const triesLeft = rec => Math.max(0, MAX_FAILS - ((rec && rec.fails) || []).length)

/** Drops records with nothing recent in them, so the file stays tiny. */
export function prune(map, now) {
  for (const [k, rec] of Object.entries(map)) {
    const recent = (rec.fails || []).some(t => now - t < WINDOW_MS)
    if (!recent && !lockedFor(rec, now)) delete map[k]
  }
  return map
}

export function lockMessage(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000))
  return `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`
}
