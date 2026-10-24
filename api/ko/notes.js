// POST /api/dealer/notes — adds a timestamped note to a deal. Staff only.
//
// Notes are append-only by design: this is the only note-writing endpoint and
// it only ever inserts. There is no update or delete route, so an existing
// note can never be silently overwritten — each update is a new row and the
// full history is kept. created_at is set by the database and created_by comes
// from the signed session, so neither can be spoofed by the caller.
const { requireStaff } = require('./_lib/session');
const { validateNote, clean } = require('./_lib/deals');
const { getDealerBySlug, getDealForDealer, insertNote, updateDealForDealer } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  const session = requireStaff(req, res);
  if (!session) return;

  const body = req.body || {};
  const dealId = clean(body.deal_id, 64);
  if (!dealId) return res.status(400).json({ ok: false, error: 'Missing deal id.' });

  const { errors, note } = validateNote(body.note);
  if (errors.length) return res.status(400).json({ ok: false, error: errors[0], errors });

  try {
    const dealer = await getDealerBySlug(session.dealerSlug);
    if (!dealer) return res.status(404).json({ ok: false, error: 'Dealer not found.' });

    // Scope check: the deal must belong to this session's dealer.
    const deal = await getDealForDealer(dealId, dealer.id);
    if (!deal) return res.status(404).json({ ok: false, error: 'Deal not found.' });

    const saved = await insertNote(dealId, note, session.name);

    // Touch the deal so a new note moves it up the "recently updated" sort and
    // the dashboard's last-updated time reflects the note.
    await updateDealForDealer(dealId, dealer.id, { updated_by: session.name });

    return res.status(201).json({ ok: true, note: saved });
  } catch (err) {
    console.error('dealer/notes: ' + err.message);
    return res.status(500).json({ ok: false, error: 'The note could not be saved. Please try again.' });
  }
};
