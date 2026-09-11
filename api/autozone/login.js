import { configured, passwordOk, sessionCookie, clearCookie } from '../_lib/auth.js'
import { send } from '../_lib/http.js'
import { readLogins, updateLogins } from '../_lib/store.js'
import { clientKey, lockedFor, afterFail, triesLeft, prune, lockMessage } from '../_lib/lockout.js'

const pause = ms => new Promise(r => setTimeout(r, ms))

export default async function handler(req, res) {
  if (req.method === 'DELETE') { res.setHeader('Set-Cookie', clearCookie()); return send(res, 200, { ok: true }) }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
  if (!configured()) return send(res, 503, { error: 'The staff password has not been set up yet. Ask Josh.' })

  const key = clientKey(req)
  // If the lockout store can't be reached, logins still work (password plus the delay below);
  // staff shouldn't be shut out because of a storage hiccup.
  let logins = {}
  try { logins = await readLogins() } catch (e) { console.error('lockout unavailable:', e.message) }

  const locked = lockedFor(logins[key], Date.now())
  if (locked) return send(res, 429, { error: lockMessage(locked) })

  const password = req.body && req.body.password
  if (!passwordOk(password)) {
    let rec = null
    try {
      rec = await updateLogins(map => {
        const now = Date.now()
        prune(map, now)
        map[key] = afterFail(map[key], now)
        return map[key]
      })
    } catch (e) { console.error('lockout unavailable:', e.message) }
    await pause(900)                                  // slows down guessing
    const lock = lockedFor(rec, Date.now())
    if (lock) return send(res, 429, { error: lockMessage(lock) })
    const left = rec ? triesLeft(rec) : null
    return send(res, 401, { error: 'That password is not right.' +
      (left !== null && left <= 3 ? ` ${left} ${left === 1 ? 'try' : 'tries'} left before a 15-minute lock.` : '') })
  }

  if (logins[key]) {
    try { await updateLogins(map => { delete map[key] }) } catch (e) { console.error('lockout unavailable:', e.message) }
  }
  res.setHeader('Set-Cookie', sessionCookie())
  send(res, 200, { ok: true })
}
