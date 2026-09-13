// Who is signed in, and what may they do.
//
// Two passwords, both set by Josh in Vercel:
//   AZ_STAFF_PASSWORD -> role "az"   Autozone. Window cards, and a read-only view of the deal board.
//   AZ_BAG_PASSWORD   -> role "bag"  Buyer Assist (Josh). Everything, plus every write on the board.
//
// Logging in sets a signed, HttpOnly cookie for 30 days carrying the role. Changing either password
// logs everyone out, because the signing secret is derived from AZ_STAFF_PASSWORD.
//
// The role in the cookie is signed, so it cannot be edited in the browser. Never trust a role that
// arrives any other way (a header, the body, a query string): read it from here.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto'

const COOKIE = 'az_session'
const DAYS = 30

export const ROLE_AZ = 'az'
export const ROLE_BAG = 'bag'
const ROLES = [ROLE_AZ, ROLE_BAG]

function secret() {
  const s = process.env.AZ_SESSION_SECRET || process.env.AZ_STAFF_PASSWORD
  return s ? 'azcards-v1|' + s : null
}
const sign = payload => createHmac('sha256', secret()).update(String(payload)).digest('base64url')
const digest = s => createHash('sha256').update(String(s)).digest()
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y) }

/**
 * Local testing only. All three must hold: the flag (set in a local .env, never in Vercel), a
 * request addressed to localhost (Vercel routes by hostname, so a deployment never sees one), and
 * not running as a preview or production deployment.
 */
export const devBypass = req => process.env.AZ_DEV_NO_AUTH === '1' &&
  !['preview', 'production'].includes(process.env.VERCEL_ENV) &&
  /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req && req.headers && req.headers.host || ''))

export const configured = () => !!process.env.AZ_STAFF_PASSWORD

/**
 * The role a password buys, or null. Both are checked every time without short-circuiting, so the
 * time taken never reveals which password was nearly right. Josh's password is checked first only
 * in the sense that it wins a tie: if both env vars are somehow set to the same string, the lower
 * privilege wins, because handing out write access by accident is the worse mistake.
 */
export function roleFor(given) {
  if (typeof given !== 'string' || !given) return null
  const az = !!process.env.AZ_STAFF_PASSWORD && same(digest(given), digest(process.env.AZ_STAFF_PASSWORD))
  const bag = !!process.env.AZ_BAG_PASSWORD && same(digest(given), digest(process.env.AZ_BAG_PASSWORD))
  if (az) return ROLE_AZ
  if (bag) return ROLE_BAG
  return null
}

/** Kept for the window-card app, which only cares that the password was one of ours. */
export const passwordOk = given => roleFor(given) !== null

export function sessionCookie(role = ROLE_AZ) {
  const r = ROLES.includes(role) ? role : ROLE_AZ
  const exp = Date.now() + DAYS * 864e5
  return `${COOKIE}=${exp}.${r}.${sign(exp + '|' + r)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

/**
 * The signed-in role, or null. Cookies issued before roles existed have no role part; they are
 * honoured as Autozone so nobody was logged out by the upgrade, and they expire on their own.
 */
export function roleOf(req) {
  if (devBypass(req)) return process.env.AZ_DEV_ROLE === ROLE_AZ ? ROLE_AZ : ROLE_BAG
  if (!secret()) return null
  const raw = ((req && req.headers && req.headers.cookie) || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='))
  if (!raw) return null
  const parts = raw.slice(COOKIE.length + 1).split('.')
  const [exp, role, mac] = parts.length === 2 ? [parts[0], ROLE_AZ, parts[1]] : parts
  if (!exp || !mac || !ROLES.includes(role) || Number(exp) < Date.now()) return null
  const payload = parts.length === 2 ? exp : exp + '|' + role
  return same(mac, sign(payload)) ? role : null
}

export const isAuthed = req => roleOf(req) !== null
export const canWrite = req => roleOf(req) === ROLE_BAG
