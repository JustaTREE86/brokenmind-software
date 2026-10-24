// Domain rules for the dealer deal tracker: the canonical stage list, plus
// validation and sanitisation for anything a staff member submits.
//
// DEAL_STATUSES is mirrored by a CHECK constraint on public.deals.status. The
// database is the real gatekeeper; this list exists to return a friendly error
// before the round trip, and is served to the browser by /api/dealer/session
// so the UI never keeps its own copy that can drift out of sync.
const { isValidAUPhone, isValidEmail } = require('./util');

const DEAL_STATUSES = [
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
];

// Which broker is running the deal. Shown as a coloured badge on
// every row of the KO board so the dealer can tell at a glance who to call.
// Mirrored by a CHECK constraint on public.deals.broker (see
// supabase/2026-10-23-add-deal-broker.sql). Served to the browser by
// /api/dealer/session, same as DEAL_STATUSES.
const DEAL_BROKERS = ['Josh', 'Jacob'];
const DEFAULT_BROKER = 'Josh';

function validateBroker(value) {
  const b = clean(value, 20);
  if (!b) return { error: null, broker: null };
  if (!DEAL_BROKERS.includes(b)) return { error: 'Choose Josh or Jacob as the broker.', broker: null };
  return { error: null, broker: b };
}

// The stage that stamps settled_at. Named rather than written out at each use
// so the bookkeeping in api/dealer/deals.js can never drift from the list above.
const SETTLED_STATUS = 'Settled';

const MAX = {
  customer_name: 120,
  customer_mobile: 30,
  customer_email: 200,
  vehicle_make: 60,
  vehicle_model: 60,
  vehicle_variant: 80,
  vehicle_registration: 20,
  vehicle_stock_number: 40,
  salesperson: 40,
  note: 4000,
  author: 80,
};

// Trim, drop control characters, and cap length. Values are parameterised by
// PostgREST (never string-concatenated into SQL) and React escapes on render,
// so this is about keeping the data clean rather than escaping for a sink.
function clean(value, max) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, max);
}

function optional(value, max) {
  const v = clean(value, max);
  return v === '' ? null : v;
}

// Returns { errors: [...], record } — record is only meaningful when errors is
// empty. `partial` skips required-field checks for edits that touch a subset.
function validateDealInput(input, { partial = false } = {}) {
  const errors = [];
  const body = input && typeof input === 'object' ? input : {};

  const customer_name = clean(body.customer_name, MAX.customer_name);
  const customer_mobile = optional(body.customer_mobile, MAX.customer_mobile);
  const customer_email = optional(body.customer_email, MAX.customer_email);
  const vehicle_make = clean(body.vehicle_make, MAX.vehicle_make);
  const vehicle_model = clean(body.vehicle_model, MAX.vehicle_model);
  const status = clean(body.status, 40);

  if (!partial) {
    if (!customer_name) errors.push('Customer full name is required.');
    if (!vehicle_make) errors.push('Vehicle make is required.');
    if (!vehicle_model) errors.push('Vehicle model is required.');
    if (!status) errors.push('Current stage is required.');
    if (!customer_mobile && !customer_email) {
      errors.push('Enter a customer mobile or an email address (at least one is required).');
    }
  }

  if (status && !DEAL_STATUSES.includes(status)) {
    errors.push('Choose a valid stage from the list.');
  }
  if (customer_mobile && !isValidAUPhone(customer_mobile)) {
    errors.push('Enter a valid Australian mobile number, for example 0400 000 000.');
  }
  if (customer_email && !isValidEmail(customer_email)) {
    errors.push('Enter a valid email address.');
  }

  let vehicle_year = null;
  if (body.vehicle_year !== '' && body.vehicle_year !== null && body.vehicle_year !== undefined) {
    const n = Number(body.vehicle_year);
    if (!Number.isInteger(n) || n < 1900 || n > 2100) {
      errors.push('Enter a valid vehicle year, for example 2022.');
    } else {
      vehicle_year = n;
    }
  }

  let vehicle_price = null;
  if (body.vehicle_price !== '' && body.vehicle_price !== null && body.vehicle_price !== undefined) {
    const n = Number(body.vehicle_price);
    if (!Number.isFinite(n) || n < 0) {
      errors.push('Enter a valid vehicle price.');
    } else {
      vehicle_price = Math.round(n * 100) / 100;
    }
  }

  const record = {
    customer_name,
    customer_mobile,
    customer_email,
    vehicle_year,
    vehicle_make,
    vehicle_model,
    vehicle_variant: optional(body.vehicle_variant, MAX.vehicle_variant),
    vehicle_registration: optional(body.vehicle_registration, MAX.vehicle_registration),
    vehicle_stock_number: optional(body.vehicle_stock_number, MAX.vehicle_stock_number),
    vehicle_price,
    status,
    // Which KO Cars salesperson this deal belongs to. Not required — the UI
    // offers a fixed dropdown (see _dealer-config.js), but this only cleans
    // and caps the value rather than checking it against that list, so a
    // roster change here never needs a matching change in this file.
    salesperson: optional(body.salesperson, MAX.salesperson),
  };

  // Broker is only written when it is sent, so an older client that doesn't
  // know about it never resets a deal to the default.
  if (body.broker !== undefined) {
    const { error, broker } = validateBroker(body.broker);
    if (error) errors.push(error);
    else if (broker) record.broker = broker;
  }

  return { errors, record };
}

function validateNote(text) {
  const note = clean(text, MAX.note);
  if (!note) return { errors: ['Enter a note before saving.'], note: '' };
  return { errors: [], note };
}

// The invoice request KO Cars get from the deal's "Request invoice" button.
// Everything is display text for one email, never stored, so it is capped and
// cleaned rather than typed. Name, address and vehicle are the minimum KO Cars
// need to raise an invoice; the rest is sent when Josh has it.
function validateInvoiceRequest(input) {
  const body = input && typeof input === 'object' ? input : {};
  const b = body.buyer && typeof body.buyer === 'object' ? body.buyer : {};
  const v = body.vehicle && typeof body.vehicle === 'object' ? body.vehicle : {};
  const f = body.finance && typeof body.finance === 'object' ? body.finance : {};
  const s = (obj, k, max = 120) => clean(obj[k], max);

  // clean() flattens newlines; the message keeps its paragraphs.
  const message = String(body.message == null ? '' : body.message)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, 2000);

  const request = {
    message,
    buyer: {
      name: s(b, 'name', MAX.customer_name),
      address: s(b, 'address', 250),
      dob: s(b, 'dob', 20),
      licence_no: s(b, 'licence_no', 30),
      licence_state: s(b, 'licence_state', 10),
      licence_expiry: s(b, 'licence_expiry', 20),
      mobile: s(b, 'mobile', MAX.customer_mobile),
      email: s(b, 'email', MAX.customer_email),
    },
    vehicle: {
      title: s(v, 'title', 200),
      stock: s(v, 'stock', MAX.vehicle_stock_number),
      vin: s(v, 'vin', 30),
      rego: s(v, 'rego', MAX.vehicle_registration),
      colour: s(v, 'colour', 40),
      odometer: s(v, 'odometer', 20),
      price: s(v, 'price', 40),
    },
    finance: {
      amount: s(f, 'amount', 40),
      deposit: s(f, 'deposit', 40),
      trade_in: s(f, 'trade_in', 120),
      lender: s(f, 'lender', 80),
    },
  };

  const errors = [];
  if (!request.message) errors.push('Write a short message to KO Cars.');
  if (!request.buyer.name) errors.push('Enter the buyer’s full legal name.');
  if (!request.buyer.address) errors.push('Enter the buyer’s address.');
  if (!request.vehicle.title) errors.push('Enter the vehicle, or fetch it from the KO Cars website.');
  if (request.buyer.email && !isValidEmail(request.buyer.email)) errors.push('Enter a valid buyer email address.');

  return { errors, request };
}

module.exports = {
  DEAL_STATUSES, SETTLED_STATUS, MAX, DEAL_BROKERS, DEFAULT_BROKER,
  clean, validateBroker, optional, validateDealInput, validateNote, validateInvoiceRequest,
};
