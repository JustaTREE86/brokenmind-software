import { isAuthed } from './auth.js'

export function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

/** Wraps a handler: staff session required, errors become a readable JSON message. */
export function staffOnly(handler, { methods = ['GET'] } = {}) {
  return async (req, res) => {
    if (!methods.includes(req.method)) return send(res, 405, { error: 'Method not allowed' })
    if (!isAuthed(req)) return send(res, 401, { error: 'Please log in again.' })
    if (req.method === 'POST' && !/application\/json/.test(req.headers['content-type'] || ''))
      return send(res, 415, { error: 'Expected JSON' })
    try { await handler(req, res) }
    catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: e.message || 'Something went wrong' }) }
  }
}
