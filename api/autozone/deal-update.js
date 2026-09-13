import { staffOnly, send, BadRequest } from '../_lib/http.js'
import { readDeals, updateDeals, readCompleteStock, readState } from '../_lib/store.js'
import { titleFor } from '../_lib/cards.js'
import {
  validateDeal, validateInvoice, carSnapshot, clean, ref, newId, nowIso,
  STATUSES, INVOICE_FROM, invoiceText,
} from '../_lib/deals.js'

// POST /api/autozone/deal-update — every change the board can make, chosen by `action`.
//
// Buyer Assist only: `write: true` on the wrapper turns Autozone's own login into a 403 here, which
// is what actually makes their view read-only. The page hiding its buttons is a courtesy, not a
// control.
//
// Notes are append-only. Stage moves, invoice requests and archiving each write their own note, so
// the history explains itself without anyone having to remember to type it out.

const LENDER_PAYABLE = 'Lender direct deposit on settlement'

function findDeal(board, id) {
  return (board.deals || []).find(d => d.id === id) || null
}

function addNote(deal, text, by, kind = 'system') {
  deal.notes = [{ at: nowIso(), by, text, kind }].concat(deal.notes || [])
  deal.updatedAt = nowIso()
  deal.updatedBy = by
}

/** The car the customer enquired on, read off the live website by its listing id. */
async function snapshotById(listingId) {
  const id = clean(listingId, 20)
  if (!id) return null
  const [stock, state] = await Promise.all([readCompleteStock(), readState()])
  const car = stock.cars.find(c => String(c.id) === id)
  if (!car) throw new BadRequest('That car is no longer on the Autozone website. Pick another, or leave the car blank.')
  return carSnapshot(car, titleFor(car, state))
}

export default staffOnly(async (req, res) => {
  const body = req.body || {}
  const action = clean(body.action, 30)
  // Who made the change. One Buyer Assist password covers Josh, so the name is taken on trust for
  // the history line, never for permission.
  const by = clean(body.by, 60) || 'Buyer Assist'
  const id = clean(body.id, 40)

  if (action === 'create') {
    const { errors, record } = validateDeal(body)
    if (errors.length) return send(res, 400, { error: errors[0], errors })
    const car = await snapshotById(body.listingId)

    const deal = await updateDeals(board => {
      board.seq = (board.seq || 0) + 1
      const created = {
        id: newId(), ref: ref(board.seq),
        createdAt: nowIso(), createdBy: by, updatedAt: nowIso(), updatedBy: by,
        statusAt: nowIso(),
        ...record, car, invoice: null, archived: false,
        notes: [{ at: nowIso(), by, kind: 'system', text: 'Deal created at "' + record.status + '".' }],
      }
      const first = clean(body.note, 4000)
      if (first) created.notes = [{ at: nowIso(), by, kind: 'note', text: first }].concat(created.notes)
      board.deals = [created].concat(board.deals || [])
      return created
    })
    return send(res, 200, { ok: true, deal })
  }

  if (!id) return send(res, 400, { error: 'Which deal?' })

  // Everything below changes an existing deal, so read it first for a clear 404 rather than a
  // silent no-op inside the swap.
  if (!findDeal(await readDeals(), id)) return send(res, 404, { error: 'That deal no longer exists.' })

  if (action === 'stage') {
    const status = clean(body.status, 40)
    if (!STATUSES.includes(status)) return send(res, 400, { error: 'Choose a stage from the list.' })
    const deal = await updateDeals(board => {
      const d = findDeal(board, id)
      if (!d || d.status === status) return d
      const from = d.status
      d.status = status
      d.statusAt = nowIso()
      addNote(d, 'Stage moved from "' + from + '" to "' + status + '".', by)
      return d
    })
    return send(res, 200, { ok: true, deal })
  }

  if (action === 'note') {
    const text = clean(body.text, 4000)
    if (!text) return send(res, 400, { error: 'Write something first.' })
    const deal = await updateDeals(board => {
      const d = findDeal(board, id)
      if (d) addNote(d, text, by, 'note')
      return d
    })
    return send(res, 200, { ok: true, deal })
  }

  if (action === 'edit') {
    const { errors, record } = validateDeal(body)
    if (errors.length) return send(res, 400, { error: errors[0], errors })
    const deal = await updateDeals(board => {
      const d = findDeal(board, id)
      if (!d) return null
      const moved = d.status !== record.status
      const from = d.status
      Object.assign(d, record)
      if (moved) {
        d.statusAt = nowIso()
        addNote(d, 'Stage moved from "' + from + '" to "' + record.status + '".', by)
      } else {
        addNote(d, 'Deal details updated.', by)
      }
      return d
    })
    return send(res, 200, { ok: true, deal })
  }

  if (action === 'car') {
    // Re-linking happens when the customer changes their mind about which car, which is common
    // enough that it needs to be two clicks rather than a new deal.
    const car = await snapshotById(body.listingId)
    const deal = await updateDeals(board => {
      const d = findDeal(board, id)
      if (!d) return null
      const was = d.car && d.car.title
      d.car = car
      addNote(d, car ? (was ? 'Car changed from ' + was + ' to ' + car.title + '.' : 'Linked to ' + car.title + ' on the website.') : 'Car unlinked.', by)
      return d
    })
    return send(res, 200, { ok: true, deal })
  }

  if (action === 'invoice') {
    // The request Autozone's admin works from. Only offered once the lender has approved, so a
    // stage check here matches what the page shows.
    const existing = findDeal(await readDeals(), id)
    if (!INVOICE_FROM.includes(existing.status)) {
      return send(res, 400, { error: 'An invoice can only be requested once the deal is approved.' })
    }
    const { errors, fields } = validateInvoice(body.fields, existing.car)
    if (errors.length) return send(res, 400, { error: errors[0], errors })
    if (!fields.payableBy) fields.payableBy = LENDER_PAYABLE

    const deal = await updateDeals(board => {
      const d = findDeal(board, id)
      if (!d) return null
      const again = !!(d.invoice && d.invoice.requestedAt)
      d.invoice = {
        ...(d.invoice || {}),
        fields,
        requestedAt: (d.invoice && d.invoice.requestedAt) || nowIso(),
        requestedBy: (d.invoice && d.invoice.requestedBy) || by,
        // A re-send after a correction clears the received flag: what Autozone sent no longer
        // matches what was asked for, so the board should chase the new one.
        receivedAt: again ? null : (d.invoice ? d.invoice.receivedAt : null) || null,
        updatedAt: nowIso(),
      }
      addNote(d, again ? 'Invoice request updated and re-sent to Autozone.' : 'Invoice requested from Autozone.', by)
      return d
    })
    return send(res, 200, { ok: true, deal, text: invoiceText(deal) })
  }

  if (action === 'invoice-received') {
    const received = body.received !== false
    const deal = await updateDeals(board => {
      const d = findDeal(board, id)
      if (!d || !d.invoice) return null
      d.invoice.receivedAt = received ? nowIso() : null
      addNote(d, received ? 'Tax invoice received from Autozone.' : 'Invoice marked as still outstanding.', by)
      return d
    })
    if (!deal) return send(res, 400, { error: 'No invoice has been requested on that deal yet.' })
    return send(res, 200, { ok: true, deal })
  }

  if (action === 'archive') {
    const archived = body.archived !== false
    const deal = await updateDeals(board => {
      const d = findDeal(board, id)
      if (!d) return null
      d.archived = archived
      addNote(d, archived ? 'Deal archived.' : 'Deal restored to the board.', by)
      return d
    })
    return send(res, 200, { ok: true, deal })
  }

  return send(res, 400, { error: 'Unknown action.' })
}, { methods: ['POST'], write: true })
