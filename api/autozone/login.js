import { configured, passwordOk, sessionCookie, clearCookie } from '../_lib/auth.js'
import { send } from '../_lib/http.js'

export default async function handler(req, res) {
  if (req.method === 'DELETE') { res.setHeader('Set-Cookie', clearCookie()); return send(res, 200, { ok: true }) }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
  if (!configured()) return send(res, 503, { error: 'The staff password has not been set up yet. Ask Josh.' })
  const password = req.body && req.body.password
  if (!passwordOk(password)) {
    await new Promise(r => setTimeout(r, 900))       // slows down guessing
    return send(res, 401, { error: 'That password is not right.' })
  }
  res.setHeader('Set-Cookie', sessionCookie())
  send(res, 200, { ok: true })
}
