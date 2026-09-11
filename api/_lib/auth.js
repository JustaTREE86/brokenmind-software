// One staff password for the Autozone team, set by Josh in Vercel as AZ_STAFF_PASSWORD.
// Logging in sets a signed, HttpOnly cookie for 30 days. Changing the password logs everyone out.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto'

const COOKIE = 'az_session'
const DAYS = 30

function secret() {
  const s = process.env.AZ_SESSION_SECRET || process.env.AZ_STAFF_PASSWORD
  return s ? 'azcards-v1|' + s : null
}
const sign = exp => createHmac('sha256', secret()).update(String(exp)).digest('base64url')
const digest = s => createHash('sha256').update(String(s)).digest()

/**
 * Local testing only. All three must hold: the flag (set in a local .env, never in Vercel), a
 * request addressed to localhost (Vercel routes by hostname, so a deployment never sees one), and
 * not running as a preview or production deployment.
 */
export const devBypass = req => process.env.AZ_DEV_NO_AUTH === '1' &&
  !['preview', 'production'].includes(process.env.VERCEL_ENV) &&
  /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req && req.headers && req.headers.host || ''))

export const configured = () => !!process.env.AZ_STAFF_PASSWORD

export function passwordOk(given) {
  const want = process.env.AZ_STAFF_PASSWORD
  if (!want || typeof given !== 'string') return false
  return timingSafeEqual(digest(given), digest(want))
}

export function sessionCookie() {
  const exp = Date.now() + DAYS * 864e5
  return `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

export function isAuthed(req) {
  if (devBypass(req)) return true
  if (!secret()) return false
  const raw = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='))
  if (!raw) return false
  const [exp, mac] = raw.slice(COOKIE.length + 1).split('.')
  if (!exp || !mac || Number(exp) < Date.now()) return false
  const a = Buffer.from(mac), b = Buffer.from(sign(exp))
  return a.length === b.length && timingSafeEqual(a, b)
}
