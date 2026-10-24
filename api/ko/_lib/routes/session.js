// GET /api/dealer/session — who am I, and what may I do?
//
// The page calls this on load to decide whether to show the login form or the
// dashboard. It returns 200 with { authenticated: false } rather than 401 for
// a signed-out visitor, because "not signed in" is a normal state here, not an
// error worth logging.
//
// It also serves DEAL_STATUSES so the browser never keeps its own copy of the
// stage list that could drift from the server and the database CHECK.
const { readSession, canWrite } = require('../session');
const { DEAL_STATUSES, DEAL_BROKERS, DEFAULT_BROKER } = require('../deals');
const { getDealerBySlug } = require('../supabase');
const { salespeopleFor } = require('../dealer-config');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  // A session cookie must never be cached by a CDN or shared proxy.
  res.setHeader('Cache-Control', 'private, no-store');

  let session = null;
  try {
    session = readSession(req);
  } catch (err) {
    console.error('dealer/session: ' + err.message);
    return res.status(500).json({ ok: false, error: 'Sessions are not configured on the server.' });
  }

  if (!session) {
    return res.status(200).json({ ok: true, authenticated: false, statuses: DEAL_STATUSES });
  }

  let dealerName = null;
  try {
    const dealer = await getDealerBySlug(session.dealerSlug);
    dealerName = dealer ? dealer.name : null;
  } catch (err) {
    console.error('dealer/session: ' + err.message);
  }

  return res.status(200).json({
    ok: true,
    authenticated: true,
    statuses: DEAL_STATUSES,
    brokers: DEAL_BROKERS,
    defaultBroker: DEFAULT_BROKER,
    // Roster of this dealer's salespeople, for staff's "assign to" dropdown
    // when adding/editing a deal. Served here so the UI never keeps its own
    // copy that could drift from _dealer-config.js.
    salespeople: salespeopleFor(session.dealerSlug),
    session: {
      role: session.role,
      name: session.name,
      dealerSlug: session.dealerSlug,
      dealerName,
      salesperson: session.salesperson || null,
      canEdit: canWrite(session),
      expiresAt: session.exp,
    },
  });
};
