// The rules of the deal board: the stage list, what a valid deal looks like, and the invoice
// request that goes to Autozone once a deal is approved.
//
// Pure functions only, so every rule here is testable without a network or a blob store.
//
// Nothing in this file records what Buyer Assist earns. The board shows the car's own price and the
// figures Autozone need to raise their tax invoice, because those are Autozone's numbers anyway.
// Brokerage and commission stay out of the data model entirely, not merely hidden in the UI.

// Mirrors the stages Josh already works to on the KO Cars board, so one brain runs both.
export const STATUSES = [
  'New Referral',
  'Contacting Customer',
  'Application Sent',
  'Waiting on Customer',
  'Documents Required',
  'Assessing',
  'Submitted to Lender',
  'Lender Reviewing',
  'Conditional Approval',
  'Approved',
  'Settlement Booked',
  'Settled',
  'Declined',
  'On Hold',
  'Unable to Contact',
  'Cancelled',
]

// Colour tone per stage. The written stage is always rendered as well, so colour is never the only
// signal for a salesperson reading the board across the yard.
export const TONES = {
  'New Referral': 'new', 'Contacting Customer': 'progress', 'Application Sent': 'progress',
  'Waiting on Customer': 'attention', 'Documents Required': 'attention', 'Assessing': 'progress',
  'Submitted to Lender': 'progress', 'Lender Reviewing': 'progress', 'Conditional Approval': 'good',
  'Approved': 'good', 'Settlement Booked': 'good', 'Settled': 'done', 'Declined': 'bad',
  'On Hold': 'attention', 'Unable to Contact': 'attention', 'Cancelled': 'bad',
}

// A deal at one of these is off the active board and onto the "Not proceeding" tab. Nothing is
// deleted by this, and moving the stage back brings the deal straight back.
export const LOST = ['Declined', 'Cancelled', 'Unable to Contact']

// Grouped rows, not one long list: a salesperson wants "what is close" before "what just came in".
export const PHASES = [
  { id: 'approved', label: 'Approved and settling', statuses: ['Conditional Approval', 'Approved', 'Settlement Booked'] },
  { id: 'lender', label: 'With the lender', statuses: ['Assessing', 'Submitted to Lender', 'Lender Reviewing'] },
  { id: 'application', label: 'Application in progress', statuses: ['Application Sent', 'Waiting on Customer', 'Documents Required'] },
  { id: 'new', label: 'New referrals', statuses: ['New Referral', 'Contacting Customer'] },
  { id: 'hold', label: 'On hold', statuses: ['On Hold'] },
  { id: 'settled', label: 'Settled', statuses: ['Settled'] },
]

// The invoice request is only offered once the lender has actually approved the deal. Asking
// Autozone to raise a tax invoice on a maybe wastes their admin's morning and confuses the customer.
export const INVOICE_FROM = ['Approved', 'Settlement Booked', 'Settled']

// A live deal nobody has touched for this long is called out on the board.
export const STALE_DAYS = 6

const MAX = { name: 120, mobile: 30, email: 200, address: 200, text: 4000, short: 80 }

export function clean(value, max = MAX.text) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}
const optional = (v, max) => clean(v, max) || null

// Deliberately loose: ten digits starting 04 (mobile) or 0x (landline), spaces and +61 forgiven.
export const isPhone = v => /^(\+?61|0)[2-8]\d{8}$/.test(String(v || '').replace(/[\s()-]/g, ''))
export const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim())

/** Money in, cents-accurate number out, or null. Negatives are refused: a credit is its own field. */
export function money(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(String(value).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0 || n > 9999999) return null
  return Math.round(n * 100) / 100
}

export const ref = seq => 'AZ-' + String(seq).padStart(3, '0')

/** A short, unguessable id. Deal ids end up in links staff paste to each other. */
export const newId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export const nowIso = () => new Date().toISOString()

/**
 * The car, as it stood on the Autozone website the moment the deal was linked to it.
 *
 * Snapshotted rather than looked up live, because the listing comes down the day the car sells and
 * the deal still has to show what was sold, at what price, with which VIN, months later. `url` and
 * `short` are kept so the board can always link back to the listing the customer enquired on.
 */
export function carSnapshot(car, title) {
  if (!car) return null
  return {
    listingId: String(car.id || ''),
    url: car.url || '', short: car.short || car.url || '',
    title: clean(title || car.rawTitle, MAX.name),
    year: clean(car.year, 8), make: clean(car.make, 40), model: clean(car.model, 60),
    price: money(car.price), odometer: clean(car.odometer, 10),
    vin: clean(car.vin, 40), colour: clean(car.colour, 40), engine: clean(car.engine, 40),
    transmission: clean(car.transmission, 30), fuel: clean(car.fuel, 30), drive: clean(car.drive, 30),
    warranty: clean(car.warranty, 60), photo: car.photo || '',
    linkedAt: nowIso(),
  }
}

/**
 * Validates what staff typed into the new/edit deal form.
 * `partial` skips the required-field checks for an edit that only touches some of them.
 */
export function validateDeal(input, { partial = false } = {}) {
  const body = input && typeof input === 'object' ? input : {}
  const errors = []

  const name = clean(body.name, MAX.name)
  const mobile = optional(body.mobile, MAX.mobile)
  const email = optional(body.email, MAX.email)
  const address = optional(body.address, MAX.address)
  const status = clean(body.status, 40)
  const salesperson = optional(body.salesperson, MAX.short)
  const lender = optional(body.lender, MAX.short)

  if (!partial) {
    if (!name) errors.push('Enter the customer name.')
    if (!mobile && !email) errors.push('Enter a mobile or an email for the customer.')
    if (!status) errors.push('Choose a stage.')
  }
  if (status && !STATUSES.includes(status)) errors.push('Choose a stage from the list.')
  if (mobile && !isPhone(mobile)) errors.push('Enter a valid Australian phone number, for example 0400 000 000.')
  if (email && !isEmail(email)) errors.push('Enter a valid email address.')

  const amount = body.amount === '' || body.amount == null ? null : money(body.amount)
  if (body.amount && amount === null) errors.push('Enter a valid finance amount.')

  return {
    errors,
    record: {
      customer: { name, mobile, email, address },
      finance: { lender, amount, term: optional(body.term, 8) },
      salesperson, status,
    },
  }
}

// What Autozone put on the tax invoice. Charges add up, credits come off. Kept as one list so the
// request document, the total and the tests can never disagree about what a line is.
export const INVOICE_CHARGES = [
  { key: 'price', label: 'Vehicle purchase price inc GST' },
  { key: 'registration', label: 'Registration' },
  { key: 'stampDuty', label: 'Stamp duty' },
  { key: 'transferFee', label: 'Transfer fee' },
  { key: 'warranty', label: 'Warranty' },
  { key: 'extras', label: 'Extras / accessories' },
]
export const INVOICE_CREDITS = [
  { key: 'deposit', label: 'Less deposit paid' },
  { key: 'tradeIn', label: 'Less trade-in allowance' },
]

/** Charges less credits. A blank line counts as zero, so a half-filled request still totals. */
export function balanceDue(fields = {}) {
  const sum = list => list.reduce((t, l) => t + (money(fields[l.key]) || 0), 0)
  return Math.round((sum(INVOICE_CHARGES) - sum(INVOICE_CREDITS)) * 100) / 100
}

/** Cleans the invoice form. Most fields are optional: Josh may not know the rego fee yet. */
export function validateInvoice(input, car) {
  const body = input && typeof input === 'object' ? input : {}
  const errors = []
  const fields = {}
  for (const l of [...INVOICE_CHARGES, ...INVOICE_CREDITS]) {
    const raw = body[l.key]
    if (raw === '' || raw == null) { fields[l.key] = null; continue }
    const v = money(raw)
    if (v === null) errors.push('Enter a valid amount for ' + l.label.toLowerCase() + '.')
    fields[l.key] = v
  }
  // The price defaults to the website price of the car the customer enquired on, so the usual case
  // is Josh confirming a figure rather than typing one.
  if (fields.price == null && car && car.price != null) fields.price = car.price

  Object.assign(fields, {
    invoiceTo: clean(body.invoiceTo, MAX.name),
    address: clean(body.address, MAX.address),
    deliverTo: clean(body.deliverTo, MAX.address),
    deliveryDate: clean(body.deliveryDate, 30),
    rego: clean(body.rego, 20),
    regoExpiry: clean(body.regoExpiry, 30),
    payableBy: clean(body.payableBy, MAX.short),
    lender: clean(body.lender, MAX.short),
    note: clean(body.note, 600),
  })
  if (!fields.invoiceTo) errors.push('The invoice needs a name to be made out to.')
  return { errors, fields }
}

const fmt = n => '$' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = iso => {
  const d = iso ? new Date(iso) : new Date()
  return Number.isNaN(Number(d)) ? '' : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Australia/Brisbane' })
}

/**
 * How the car reads on the invoice. Autozone's own listing titles almost always start with the
 * year, so the year is only added when it is missing rather than printed twice.
 */
export function vehicleName(car = {}) {
  const title = car.title || [car.make, car.model].filter(Boolean).join(' ')
  if (!title) return car.year || ''
  if (!car.year || title.indexOf(car.year) === 0) return title
  return car.year + ' ' + title
}

/**
 * The request itself, as plain text.
 *
 * Built on the server so the printed page, the copied text and the emailed version are the same
 * words. Autozone's admin reads this and types their tax invoice from it, so every line they need
 * is here, in the order their invoice lays them out, and nothing else is.
 */
export function invoiceText(deal) {
  const inv = deal.invoice || {}
  const f = inv.fields || {}
  const car = deal.car || {}
  const L = []
  // Wide enough for the longest line item ("Vehicle purchase price inc GST:"), and a label that
  // still runs past it gets a single space rather than butting up against its own figure.
  const PAD = 32
  const line = (label, value) => {
    if (value === '' || value == null) return
    L.push((label.length >= PAD ? label + ' ' : label.padEnd(PAD)) + value)
  }

  L.push('TAX INVOICE REQUEST - ' + deal.ref)
  L.push('Autozone QLD Pty Ltd')
  L.push('')
  L.push('Finance approved' + (f.lender ? ' with ' + f.lender : '') + '. Please raise your tax invoice as below')
  L.push('and send it to Buyer Assist Group so we can book settlement.')
  L.push('')
  L.push('CUSTOMER')
  line('Invoice to:', f.invoiceTo)
  line('Address:', f.address)
  line('Deliver to:', f.deliverTo || 'As above')
  line('Delivery date:', f.deliveryDate)
  L.push('')
  L.push('VEHICLE')
  line('Being for:', 'Used vehicle')
  line('Vehicle:', vehicleName(car))
  line('VIN:', car.vin)
  // The website publishes engine capacity, not the engine number stamped on the block. Labelling it
  // "Engine no" would put a wrong figure on a tax invoice, so it is named for what it actually is
  // and Autozone fill the engine number in from their own records.
  line('Engine size:', car.engine)
  line('Colour:', car.colour)
  line('Odometer:', car.odometer ? Number(car.odometer).toLocaleString('en-AU') + ' km' : '')
  line('Transmission:', car.transmission)
  line('Rego:', f.rego)
  line('Rego expiry:', f.regoExpiry)
  line('Listing:', car.short || car.url)
  L.push('')
  L.push('PURCHASE DETAILS')
  for (const l of INVOICE_CHARGES) if (f[l.key] != null) line(l.label + ':', fmt(f[l.key]))
  for (const l of INVOICE_CREDITS) if (f[l.key] != null) line(l.label + ':', '-' + fmt(f[l.key]))
  L.push(''.padEnd(PAD) + '--------------')
  line('BALANCE DUE:', fmt(balanceDue(f)))
  L.push('')
  L.push('PAYMENT')
  line('Payable by:', f.payableBy || 'Lender direct deposit on settlement')
  if (f.note) { L.push(''); L.push('NOTES'); L.push(f.note) }
  L.push('')
  L.push('Requested by ' + (inv.requestedBy || 'Buyer Assist Group') + ' on ' + day(inv.requestedAt))
  L.push('Buyer Assist Group · Josh Marien · 0480 852 530 · josh@thebuyerassist.com.au')
  return L.join('\n')
}

const days = (from, to) => Math.floor((to - Date.parse(from)) / 864e5)

/**
 * Adds the things the board reacts to. Derived here rather than stored, so a flag can never go
 * stale in the blob: `soldElsewhere` in particular has to answer "is this car still listed *now*".
 */
export function decorate(deal, { listedIds = null, now = Date.now() } = {}) {
  const active = !LOST.includes(deal.status) && deal.status !== 'Settled' && !deal.archived
  const inv = deal.invoice || null
  const touched = deal.updatedAt || deal.createdAt
  return {
    ...deal,
    tone: TONES[deal.status] || 'progress',
    lost: LOST.includes(deal.status),
    canInvoice: INVOICE_FROM.includes(deal.status),
    needsInvoice: INVOICE_FROM.includes(deal.status) && !(inv && inv.requestedAt),
    awaitingInvoice: !!(inv && inv.requestedAt && !inv.receivedAt),
    daysInStage: days(deal.statusAt || deal.createdAt, now),
    daysSinceUpdate: days(touched, now),
    stale: active && days(touched, now) >= STALE_DAYS,
    // The listing went off the website while the deal was still live. Usually it sold to a cash
    // buyer while the finance was in train, and Autozone need to know before the customer does.
    soldElsewhere: !!(active && listedIds && deal.car && deal.car.listingId && !listedIds.has(deal.car.listingId)),
    invoiceText: inv && inv.requestedAt ? invoiceText(deal) : null,
  }
}
