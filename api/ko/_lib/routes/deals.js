// /api/dealer/deals — the dashboard's data endpoint.
//
//   GET   list the signed-in dealer's deals (staff and dealer users)
//   POST  create a deal            (staff only)
//   PATCH edit / restage / archive (staff only). 
//
//   GET  ?action=vehicle           look a car up on the KO Cars website (staff)
//   POST ?action=invoice-request   returns invoice request text to copy (staff, no email)
//
// The two actions live here rather than in their own files because the
// project is at 11 of Vercel Hobby's 12 functions (see README).
//
// Security notes:
//  - The dealer scope always comes from the signed session cookie, never from
//    the request. A caller cannot ask for another dealer's deals by passing a
//    different id, so there is no endpoint here that returns "all deals".
//  - Every login for a dealer sees that dealer's whole board. session.salesperson
//    names who is signed in (for notes and the header); it is deliberately not
//    a filter, so Alan, Charlie and Jacob see the same deals.
//  - Writes go through requireStaff, so a dealer session is read-only on the
//    server unless its roster row has canWrite (Jacob). Hiding the buttons in
//    the UI is only cosmetic.
const { requireSession, requireStaff } = require('../session');
const { validateDealInput, validateInvoiceRequest, validateBroker, clean, SETTLED_STATUS } = require('../deals');
const { lookupVehicle } = require('../ko-vehicle');
const {
  getDealerBySlug,
  listDealsForDealer,
  getDealForDealer,
  insertDeal,
  updateDealForDealer,
  insertNote,
} = require('../supabase');

async function handleGet(req, res, session, dealer) {
  const archived = String((req.query && req.query.archived) || 'false') === 'true';

  // Whole board, every time. Staff and dealer logins get the same list; the
  // only difference between them is that a dealer session cannot write.
  const deals = await listDealsForDealer(dealer.id, { archived });

  return res.status(200).json({
    ok: true,
    deals,
    dealer: { name: dealer.name, slug: dealer.slug },
    fetchedAt: new Date().toISOString(),
  });
}

async function handlePost(req, res, session, dealer) {
  const { errors, record } = validateDealInput(req.body || {});
  if (errors.length) return res.status(400).json({ ok: false, error: errors[0], errors });

  const initialNote = clean((req.body || {}).initial_note, 4000);

  const deal = await insertDeal({
    ...record,
    dealer_id: dealer.id,
    // Rare, but a deal can be entered after the fact at its final stage. Stamp
    // it now so it lands in this month's total like any other settlement.
    settled_at: record.status === SETTLED_STATUS ? new Date().toISOString() : null,
    created_by: session.name,
    updated_by: session.name,
  });
  if (!deal) return res.status(500).json({ ok: false, error: 'The deal could not be saved.' });

  // Opening entry in the history, so every deal has a starting point even if
  // staff didn't type a note.
  const opening = initialNote || `Deal created at stage "${record.status}".`;
  await insertNote(deal.id, opening, session.name);

  return res.status(201).json({ ok: true, deal });
}

async function handlePatch(req, res, session, dealer) {
  const body = req.body || {};
  const id = clean(body.id, 64);
  if (!id) return res.status(400).json({ ok: false, error: 'Missing deal id.' });

  // Confirms the deal belongs to this dealer before touching it. A deal under
  // another dealer reads as "not found" — the caller can't tell it exists.
  const existing = await getDealForDealer(id, dealer.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Deal not found.' });

  const patch = { updated_by: session.name };

  // Archive / restore on its own, without touching the rest of the record.
  if (typeof body.archived === 'boolean') {
    patch.archived = body.archived;
  }

  // Distinguishes a full edit from the dashboard's stage-only dropdown. These
  // three are sent by the edit form and nothing else, so `status` must NOT be
  // one of them — a stage-only change sends status alone, and treating that as
  // a full edit would fail validation for the customer/vehicle fields it never
  // sent.
  const editingFields = ['customer_name', 'vehicle_make', 'vehicle_model']
    .some(k => Object.prototype.hasOwnProperty.call(body, k));

  let statusChange = null;

  if (editingFields) {
    const { errors, record } = validateDealInput(body);
    if (errors.length) return res.status(400).json({ ok: false, error: errors[0], errors });
    Object.assign(patch, record);
    if (record.status && record.status !== existing.status) {
      statusChange = { from: existing.status, to: record.status };
    }
  } else if (typeof body.status === 'string' && body.status) {
    // Stage-only change from the dashboard dropdown.
    const { errors, record } = validateDealInput({ status: body.status }, { partial: true });
    if (errors.length) return res.status(400).json({ ok: false, error: errors[0], errors });
    if (record.status !== existing.status) {
      patch.status = record.status;
      statusChange = { from: existing.status, to: record.status };
    }
  }

  // Broker-only change from the board's broker dropdown. A full edit already
  // carried broker through validateDealInput above.
  let brokerChange = null;
  if (!editingFields && typeof body.broker === 'string') {
    const { error, broker } = validateBroker(body.broker);
    if (error || !broker) return res.status(400).json({ ok: false, error: error || 'Choose a broker.' });
    patch.broker = broker;
  }
  if (patch.broker && patch.broker !== (existing.broker || null)) {
    brokerChange = patch.broker;
  }

  // settled_at is bookkeeping, never something the client sends. Stamped on the
  // move into Settled and cleared on the way back out, so a deal marked settled
  // by mistake and corrected the next day leaves the month's total cleanly.
  // Re-saving a deal that was already settled does not restamp it — the date it
  // settled does not change because someone fixed a typo in the rego.
  if (statusChange) {
    if (statusChange.to === SETTLED_STATUS) patch.settled_at = new Date().toISOString();
    else if (statusChange.from === SETTLED_STATUS) patch.settled_at = null;
  }

  const deal = await updateDealForDealer(id, dealer.id, patch);
  if (!deal) return res.status(404).json({ ok: false, error: 'Deal not found.' });

  // Stage moves and archiving are logged to the history automatically.
  // (No email notifications on this board.)
  if (statusChange) {
    await insertNote(id, `Stage changed from "${statusChange.from}" to "${statusChange.to}".`, session.name);
  }
  if (brokerChange) {
    await insertNote(id, `Broker set to ${brokerChange}.`, session.name);
  }
  if (typeof body.archived === 'boolean' && body.archived !== existing.archived) {
    await insertNote(id, body.archived ? 'Deal archived.' : 'Deal restored to the active list.', session.name);
  }

  return res.status(200).json({ ok: true, deal, emailed: null });
}

// GET ?action=vehicle&q=<stock|rego|VIN|listing link>&year=&make=&model=
async function handleVehicleLookup(req, res) {
  const q = clean(req.query && req.query.q, 300);
  const hint = {
    year: clean(req.query && req.query.year, 4),
    make: clean(req.query && req.query.make, 60),
    model: clean(req.query && req.query.model, 60),
  };
  try {
    const result = await lookupVehicle(q, hint);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('dealer/deals: vehicle lookup failed: ' + err.message);
    return res.status(502).json({
      ok: false,
      error: 'Could not reach the KO Cars website. Fill the vehicle in by hand.',
    });
  }
}

// POST ?action=invoice-request  { id, message, buyer, vehicle, finance }
async function handleInvoiceRequest(req, res, session, dealer) {
  const body = req.body || {};
  const id = clean(body.id, 64);
  if (!id) return res.status(400).json({ ok: false, error: 'Missing deal id.' });

  const deal = await getDealForDealer(id, dealer.id);
  if (!deal) return res.status(404).json({ ok: false, error: 'Deal not found.' });

  const { errors, request } = validateInvoiceRequest(body);
  if (errors.length) return res.status(400).json({ ok: false, error: errors[0], errors });

  // Email notifications are switched off on this board. Nothing is sent and
  // nothing is written: the request text is handed back for Josh to copy into
  // his own mail app.
  return res.status(200).json({ ok: false, copyOnly: true,
    error: 'Emails are switched off here. Copy the text below into your own email.',
    fallback: buildInvoiceText(request) });
}

function buildInvoiceText(r) {
  const b = r.buyer || {}; const v = r.vehicle || {}; const f = r.finance || {};
  const lines = [r.message || '', '', 'BUYER'];
  for (const [k, val] of Object.entries(b)) if (val) lines.push(`${k}: ${val}`);
  lines.push('', 'VEHICLE');
  for (const [k, val] of Object.entries(v)) if (val && typeof val !== 'object') lines.push(`${k}: ${val}`);
  lines.push('', 'FINANCE');
  for (const [k, val] of Object.entries(f)) if (val && typeof val !== 'object') lines.push(`${k}: ${val}`);
  return { to: '', subject: `Invoice request: ${v.title || ''}`.trim(), text: lines.join('\n') };
}

module.exports = async function handler(req, res) {
  // Customer PII — never let a CDN or browser cache hold a copy.
  res.setHeader('Cache-Control', 'private, no-store');

  const method = req.method;
  const isWrite = method === 'POST' || method === 'PATCH';

  if (method !== 'GET' && !isWrite) {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  const action = String((req.query && req.query.action) || '');

  // Both actions are staff only, including the GET: the vehicle lookup makes
  // outbound requests and a dealer login has no use for it.
  const staffOnly = isWrite || action === 'vehicle';
  const session = staffOnly ? requireStaff(req, res) : requireSession(req, res);
  if (!session) return; // guard already sent 401/403

  if (action === 'vehicle') {
    if (method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return handleVehicleLookup(req, res);
  }

  try {
    const dealer = await getDealerBySlug(session.dealerSlug);
    if (!dealer) return res.status(404).json({ ok: false, error: 'Dealer not found.' });

    if (action === 'invoice-request') {
      if (method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return await handleInvoiceRequest(req, res, session, dealer);
    }
    if (action) return res.status(400).json({ ok: false, error: 'Unknown action.' });

    if (method === 'GET') return await handleGet(req, res, session, dealer);
    if (method === 'POST') return await handlePost(req, res, session, dealer);
    return await handlePatch(req, res, session, dealer);
  } catch (err) {
    // Log the detail server-side; return something generic so database shape
    // and constraint names never reach the browser.
    console.error('dealer/deals: ' + err.message);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Please refresh and try again.' });
  }
};
