import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateDeal, validateInvoice, balanceDue, invoiceText, decorate, carSnapshot, vehicleName,
  money, ref, clean, STATUSES, INVOICE_FROM, STALE_DAYS,
} from '../../api/_lib/deals.js'

const DAY = 864e5

test('a deal needs a name, a way to contact them and a real stage', () => {
  assert.deepEqual(validateDeal({ name: 'Iloa Matagi', mobile: '0400 000 000', status: 'New Referral' }).errors, [])
  assert.match(validateDeal({ mobile: '0400 000 000', status: 'New Referral' }).errors[0], /name/)
  assert.match(validateDeal({ name: 'Iloa', status: 'New Referral' }).errors[0], /mobile or an email/)
  assert.match(validateDeal({ name: 'Iloa', mobile: '0400 000 000', status: 'Halfway' }).errors[0], /stage from the list/)
  assert.match(validateDeal({ name: 'Iloa', mobile: '12345', status: 'New Referral' }).errors[0], /Australian phone/)
  assert.match(validateDeal({ name: 'Iloa', email: 'nope', status: 'New Referral' }).errors[0], /email/)
  // An edit that only moves the stage must not demand the fields it never sent.
  assert.deepEqual(validateDeal({ status: 'Approved' }, { partial: true }).errors, [])
})

test('control characters and silly lengths are cleaned off what staff type', () => {
  assert.equal(clean('Iloa' + String.fromCharCode(0) + '  Matagi '), 'Iloa Matagi')
  assert.equal(clean('x'.repeat(500), 10).length, 10)
})

test('money takes what a broker actually types, and refuses what it should', () => {
  assert.equal(money('$18,880'), 18880)
  assert.equal(money('18880.005'), 18880.01)
  assert.equal(money(''), null)
  assert.equal(money('-500'), null, 'a credit is its own field, never a negative charge')
  assert.equal(money('abc'), null)
})

test('the balance matches a real Autozone-style invoice', () => {
  // The figures off a live KO Cars tax invoice: price, rego, stamp duty and transfer fee.
  const fields = { price: 18880, registration: 590, stampDuty: 500, transferFee: 30, deposit: 0 }
  assert.equal(balanceDue(fields), 20000)
  assert.equal(balanceDue({ ...fields, deposit: 2000, tradeIn: 3000 }), 15000)
  assert.equal(balanceDue({}), 0, 'a half-filled request still totals')
})

test('the invoice request carries every line Autozone need to raise the tax invoice', () => {
  const car = carSnapshot({
    id: '101', url: 'https://autozoneqldptyltd.com/listing/ford-ranger', short: 'https://autozoneqldptyltd.com/?p=101',
    rawTitle: '2015 Ford Ranger PX XLS Dual Cab', year: '2015', make: 'Ford', model: 'Ranger',
    price: '18880', odometer: '238079', vin: 'MNAUMFF50FW438727', colour: 'Black', engine: 'P5AT2038032',
    transmission: 'Auto',
  })
  const deal = {
    ref: 'AZ-001', car,
    customer: { name: 'Iloa Matagi' },
    invoice: {
      requestedAt: '2026-09-13T01:00:00.000Z', requestedBy: 'Josh',
      fields: {
        invoiceTo: 'Iloa Matagi', address: '24 Ronson St, Durack 4077', lender: 'Plenti',
        price: 18880, registration: 590, stampDuty: 500, transferFee: 30, deposit: 0, rego: '820YWK',
      },
    },
  }
  const text = invoiceText(deal)
  for (const must of ['TAX INVOICE REQUEST - AZ-001', 'Iloa Matagi', '24 Ronson St', 'Plenti',
    'MNAUMFF50FW438727', 'Black', '238,079 km', '820YWK', '$18,880.00', '$20,000.00',
    'https://autozoneqldptyltd.com/?p=101', 'Lender direct deposit on settlement']) {
    assert.ok(text.includes(must), 'missing from the request: ' + must)
  }
})

test('the year is never printed twice in the vehicle name', () => {
  assert.equal(vehicleName({ year: '2015', title: '2015 Ford Ranger PX XLS' }), '2015 Ford Ranger PX XLS')
  assert.equal(vehicleName({ year: '2015', title: 'Ford Ranger PX XLS' }), '2015 Ford Ranger PX XLS')
  assert.equal(vehicleName({ year: '2015', make: 'Ford', model: 'Ranger' }), '2015 Ford Ranger')
})

test('an invoice request is refused without a name to make it out to, and defaults the price to the listing', () => {
  const car = { price: 18880 }
  assert.match(validateInvoice({ invoiceTo: '' }, car).errors[0], /made out to/)
  const { errors, fields } = validateInvoice({ invoiceTo: 'Iloa Matagi' }, car)
  assert.deepEqual(errors, [])
  assert.equal(fields.price, 18880, 'the website price is offered rather than typed again')
  assert.match(validateInvoice({ invoiceTo: 'Iloa', stampDuty: 'lots' }, car).errors[0], /stamp duty/)
})

test('the invoice request is only offered once the lender has approved', () => {
  const base = { status: 'Submitted to Lender', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), statusAt: new Date().toISOString() }
  assert.equal(decorate(base).canInvoice, false)
  assert.equal(decorate({ ...base, status: 'Conditional Approval' }).canInvoice, false, 'a conditional is not an approval')
  for (const status of INVOICE_FROM) assert.equal(decorate({ ...base, status }).canInvoice, true, status)
  assert.equal(decorate({ ...base, status: 'Approved' }).needsInvoice, true)
  assert.equal(decorate({ ...base, status: 'Approved', invoice: { requestedAt: base.createdAt } }).needsInvoice, false)
  assert.equal(decorate({ ...base, status: 'Approved', invoice: { requestedAt: base.createdAt } }).awaitingInvoice, true)
  assert.equal(decorate({ ...base, status: 'Approved', invoice: { requestedAt: base.createdAt, receivedAt: base.createdAt } }).awaitingInvoice, false)
})

test('a live deal whose car has left the website is flagged, a finished one is not', () => {
  const now = Date.now()
  const deal = { status: 'Application Sent', createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), car: { listingId: '101' } }
  const listed = new Set(['202'])
  assert.equal(decorate(deal, { listedIds: listed, now }).soldElsewhere, true)
  assert.equal(decorate(deal, { listedIds: new Set(['101']), now }).soldElsewhere, false)
  assert.equal(decorate({ ...deal, status: 'Settled' }, { listedIds: listed, now }).soldElsewhere, false)
  assert.equal(decorate({ ...deal, status: 'Declined' }, { listedIds: listed, now }).soldElsewhere, false)
  // A half-read website gives no ids at all, and must never make a car look sold.
  assert.equal(decorate(deal, { listedIds: null, now }).soldElsewhere, false)
})

test('a live deal nobody has touched for six days is called out, a settled one is left alone', () => {
  const now = Date.now()
  const old = new Date(now - STALE_DAYS * DAY).toISOString()
  assert.equal(decorate({ status: 'Waiting on Customer', createdAt: old, updatedAt: old, statusAt: old }, { now }).stale, true)
  assert.equal(decorate({ status: 'Settled', createdAt: old, updatedAt: old, statusAt: old }, { now }).stale, false)
  assert.equal(decorate({ status: 'Waiting on Customer', createdAt: old, updatedAt: new Date(now).toISOString(), statusAt: old }, { now }).stale, false)
  assert.equal(decorate({ status: 'Waiting on Customer', createdAt: old, updatedAt: old, statusAt: old }, { now }).daysInStage, STALE_DAYS)
})

test('references read AZ-001 upwards, and every stage has a tone', () => {
  assert.equal(ref(1), 'AZ-001')
  assert.equal(ref(142), 'AZ-142')
  for (const status of STATUSES) {
    assert.ok(decorate({ status, createdAt: new Date().toISOString() }).tone, 'no tone for ' + status)
  }
})
