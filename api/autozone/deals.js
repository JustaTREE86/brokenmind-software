import { staffOnly, send } from '../_lib/http.js'
import { readDeals, readStock, readState } from '../_lib/store.js'
import { titleFor } from '../_lib/cards.js'
import { decorate, STATUSES, PHASES, LOST, INVOICE_CHARGES, INVOICE_CREDITS, INVOICE_FROM, STALE_DAYS } from '../_lib/deals.js'
import { ROLE_BAG } from '../_lib/auth.js'

// GET /api/autozone/deals — everything the board draws itself from, in one request.
//
// Both roles get the same deals: Autozone referred these customers, so they see the whole board.
// What Autozone do not get is the car picker, which is only useful to whoever can create a deal.
//
// The stage list, the phases and the invoice line items are all served from the server so the page
// never keeps its own copy that can drift from the rules in _lib/deals.js.
export default staffOnly(async (req, res, role) => {
  const [board, state] = await Promise.all([readDeals(), readState()])

  // The last complete read of the website, whatever its age: this endpoint must stay fast, and a
  // ten-minute-old stock list is plenty to answer "is this car still listed". A half-finished read
  // gives no ids at all rather than a partial set, so a car we simply have not read yet can never
  // be reported as sold out from under a live deal.
  let stock = null
  try { stock = await readStock({ anyAge: true }) } catch { stock = null }
  const complete = stock && !stock.pending
  const listedIds = complete ? new Set(stock.cars.map(c => String(c.id))) : null

  const deals = (board.deals || []).map(d => decorate(d, { listedIds }))
  deals.sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))

  // The car picker: the live website, tidied through the same name fixes the window cards use, so a
  // car reads the same in both apps.
  const cars = role === ROLE_BAG && complete
    ? stock.cars.map(c => ({
        id: String(c.id), title: titleFor(c, state), year: c.year, make: c.make, model: c.model,
        price: c.price, odometer: c.odometer, photo: c.photo, url: c.url, short: c.short,
        vin: c.vin, colour: c.colour,
      }))
    : []

  send(res, 200, {
    role,
    canEdit: role === ROLE_BAG,
    deals,
    cars,
    stockAt: stock ? stock.at : null,
    stockReady: !!complete,
    // Where the invoice request is emailed. Unset simply means the email opens with an empty To.
    invoiceEmail: process.env.AZ_INVOICE_EMAIL || '',
    rules: { statuses: STATUSES, phases: PHASES, lost: LOST, invoiceFrom: INVOICE_FROM, staleDays: STALE_DAYS,
             charges: INVOICE_CHARGES, credits: INVOICE_CREDITS },
  })
})
