import { staffOnly, send } from '../_lib/http.js'
import { readStock, readState } from '../_lib/store.js'
import { reconcile } from '../_lib/cards.js'

// GET /api/autozone/stock            the last complete read, instantly, flagged `stale` after 10 minutes
// GET /api/autozone/stock?refresh=1  read the website now (only listings that changed)
//
// Until every listing has been read at least once, no statuses are sent: a car we haven't read
// yet must never look sold. The page keeps calling until `syncing` is false.
export default staffOnly(async (req, res) => {
  const force = /^(1|true)$/.test(String(req.query.refresh || ''))
  const [stock, state] = await Promise.all([readStock({ force, anyAge: !force }), readState()])
  if (stock.pending > 0) {
    return send(res, 200, { syncing: true, read: stock.listed - stock.pending, listed: stock.listed, error: stock.error || null })
  }
  const { cars, sold } = reconcile(stock.cars, state)
  const order = { relisted: 0, changed: 1, new: 2, ok: 3 }
  cars.sort((a, b) => order[a.status] - order[b.status] || String(a.title).localeCompare(String(b.title)))
  send(res, 200, {
    syncing: false, syncedAt: stock.at, fromCache: stock.fromCache, error: stock.error || null,
    stale: Date.now() - Date.parse(stock.at) > 10 * 60 * 1000,
    failed: (stock.failed || []).length, cars, sold,
    log: (state.log || []).slice(0, 25), canUndo: !!state.undo
  })
})
