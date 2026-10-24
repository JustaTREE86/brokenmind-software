// POST /api/dealer/login — exchanges a password for a signed session cookie.
//
// Two roles share one form. The password decides which:
//   BUYER_ASSIST_STAFF_PASSWORD -> staff  (read/write, sees every dealer)
//   a roster password           -> dealer (pinned to that dealer AND to the
//                                  one salesperson the password belongs to;
//                                  read-only unless the roster row has
//                                  canWrite — see _dealer-config.js)
//
// Passwords exist only as env vars on the server. They are never sent to the
// browser and never stored in the database — the browser only ever posts one
// here and receives an HttpOnly cookie back.
const { setSessionCookie, timingSafeEqualStr, ROLE_STAFF, ROLE_DEALER } = require('./_lib/session');
const { clean } = require('./_lib/deals');
const { getDealerBySlug } = require('./_lib/supabase');
const { loginsFor, isKnownDealer } = require('./_lib/dealer-config');

// Small in-memory throttle to blunt password guessing. Serverless instances
// are ephemeral and there can be several at once, so this is a speed bump,
// not a guarantee — the real protection is a long, random password.
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(ip, { first: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : String(fwd || '')).split(',')[0].trim() || 'unknown';
}

// Checks the supplied password against every configured password for this
// dealer without short-circuiting, so response timing can't reveal which
// login was matched (or nearly matched). Returns { role, salesperson } or
// null — salesperson is null for staff, and for a dealer login it is always
// the one person that password belongs to.
function resolveLogin(password, slug) {
  const staffPassword = process.env.BUYER_ASSIST_STAFF_PASSWORD;
  const staffHit = Boolean(staffPassword) && timingSafeEqualStr(password, staffPassword);

  let dealerHit = null;
  for (const login of loginsFor(slug)) {
    const configured = process.env[login.passwordEnv];
    const hit = Boolean(configured) && timingSafeEqualStr(password, configured);
    if (hit) dealerHit = login;
  }

  if (staffHit) return { role: ROLE_STAFF, salesperson: null, canWrite: true };
  if (dealerHit) return { role: ROLE_DEALER, salesperson: dealerHit.salesperson, canWrite: dealerHit.canWrite === true };
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  const body = req.body || {};
  const slug = clean(body.dealer, 60).toLowerCase();
  const name = clean(body.name, 80);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!isKnownDealer(slug)) {
    return res.status(404).json({ ok: false, error: 'Unknown dealer.' });
  }
  if (!name) {
    return res.status(400).json({ ok: false, error: 'Please enter your name.' });
  }
  if (!password) {
    return res.status(400).json({ ok: false, error: 'Please enter the password.' });
  }

  const anyConfigured = Boolean(process.env.BUYER_ASSIST_STAFF_PASSWORD)
    || loginsFor(slug).some((login) => Boolean(process.env[login.passwordEnv]));
  if (!anyConfigured) {
    console.error('dealer/login: no passwords configured for ' + slug);
    return res.status(500).json({ ok: false, error: 'Dealer login is not configured yet.' });
  }

  if (tooManyAttempts(clientIp(req))) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  let login;
  try {
    login = resolveLogin(password, slug);
  } catch (err) {
    console.error('dealer/login: ' + err.message);
    return res.status(500).json({ ok: false, error: 'Could not sign you in right now.' });
  }

  // One message for every failure — never reveal whether the password was
  // close, or which role/salesperson it nearly matched.
  if (!login) {
    return res.status(401).json({ ok: false, error: 'Incorrect password.' });
  }

  // For a scoped dealer login, identity comes from the password, not from
  // whatever the browser typed into "your name" — that field only matters
  // for staff, who share one password between several people.
  const { role, salesperson, canWrite } = login;
  const displayName = salesperson || name;

  try {
    const dealer = await getDealerBySlug(slug);
    if (!dealer) {
      console.error('dealer/login: no dealer row for slug ' + slug);
      return res.status(500).json({ ok: false, error: 'Dealer record is missing. Contact Josh.' });
    }
    setSessionCookie(res, { role, dealerSlug: slug, name: displayName, salesperson });
    return res.status(200).json({
      ok: true,
      session: { role, name: displayName, dealerSlug: slug, dealerName: dealer.name, salesperson, canEdit: canWrite },
    });
  } catch (err) {
    console.error('dealer/login: ' + err.message);
    return res.status(500).json({ ok: false, error: 'Could not sign you in right now.' });
  }
};
