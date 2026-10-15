// GET /api/autozone/photo?id=30046
// The repayment photo stored for that car. Staff only. The id has to be one of our own
// listings: the picture is never fetched from an address the caller supplies.
// If the sync has not stamped it yet, this makes that one photo and then downloads it.

import { staffOnly, send } from '../_lib/http.js'
import { readCompleteStock, readPhotoIndex, readState } from '../_lib/store.js'
import { reconcile } from '../_lib/cards.js'
import { termsKey } from '../_lib/finance.js'
import { photoDecision, repaymentFileName } from '../_lib/repayment-photo.js'
import { ensureRepaymentPhotos, readReadyPhoto } from '../_lib/photos.js'

export default staffOnly(async (req, res) => {
  const id = String(req.query.id || '')
  if (!/^\d{1,10}$/.test(id)) return send(res, 400, { error: 'Unknown car' })

  const [stock, state] = await Promise.all([readCompleteStock(), readState()])
  const { cars } = reconcile(stock.cars, state)
  const car = cars.find(c => c.id === id)
  if (!car) return send(res, 404, { error: 'That car is no longer on the website' })
  if (!car.photo) return send(res, 404, { error: 'That listing has no photo' })

  const index = await readPhotoIndex()
  const decision = photoDecision(car, index.items?.[car.id], termsKey())
  let stored = decision === 'ready' ? await readReadyPhoto(id) : null
  if (!stored) {
    await ensureRepaymentPhotos(cars, { budgetMs: 25000, onlyId: id, force: true })
    stored = await readReadyPhoto(id)
  }
  const after = await readPhotoIndex()
  const now = photoDecision(car, after.items?.[car.id], termsKey())
  if (!stored || now !== 'ready') {
    const why = after.items?.[car.id]?.error || 'The repayment photo could not be made'
    return send(res, 502, { error: why })
  }

  const bytes = Buffer.from(await new Response(stored.stream).arrayBuffer())
  res.statusCode = 200
  res.setHeader('Content-Type', 'image/jpeg')
  res.setHeader('Content-Disposition', 'attachment; filename="' + repaymentFileName(car) + '"')
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(bytes)
})
