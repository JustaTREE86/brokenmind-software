import { roleOf, ROLE_BAG } from './auth.js'

/** Something the caller can fix by choosing differently. Answered 400, and not logged as a fault. */
export class BadRequest extends Error {}

export function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

/**
 * Wraps a handler: a signed-in session required, errors become a readable JSON message. The
 * handler is called with the role ('az' or 'bag') as its third argument.
 *
 * `write: true` additionally demands Buyer Assist's password. Autozone's own login is read-only on
 * the deal board, and this is where that is actually enforced — hiding the buttons in the page is
 * only cosmetic, so never rely on it.
 */
export function staffOnly(handler, { methods = ['GET'], write = false } = {}) {
  return async (req, res) => {
    if (!methods.includes(req.method)) return send(res, 405, { error: 'Method not allowed' })
    const role = roleOf(req)
    if (!role) return send(res, 401, { error: 'Please log in again.' })
    if (write && role !== ROLE_BAG) return send(res, 403, { error: 'This board is read-only for Autozone. Ask Josh to make the change.' })
    if (req.method === 'POST' && !/application\/json/.test(req.headers['content-type'] || ''))
      return send(res, 415, { error: 'Expected JSON' })
    try { await handler(req, res, role) }
    catch (e) {
      if (e instanceof BadRequest) return send(res, 400, { error: e.message })
      console.error(e)
      if (!res.headersSent) send(res, 500, { error: e.message || 'Something went wrong' })
    }
  }
}
