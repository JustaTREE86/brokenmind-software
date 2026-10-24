// Server-side sessions for the hidden dealer dashboard.
//
// No npm deps (this project has no build step), so sessions are a signed
// cookie rather than a library: base64url(payload).base64url(HMAC-SHA256).
// The cookie is HttpOnly, so JavaScript on the page can never read it and no
// credential is ever kept in localStorage. Tampering with the payload breaks
// the signature; expiry is carried inside the signed payload so the server
// enforces it even if the browser keeps sending an old cookie.
//
// The passwords themselves live only in env vars and only ever travel from
// the browser to /api/dealer/login — they are never part of the frontend.
const crypto = require('crypto');
const { salespersonCanWrite } = require('./dealer-config');

const COOKIE_NAME = 'bm_ko_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours, then re-login.

const ROLE_STAFF = 'staff';
const ROLE_DEALER = 'dealer';

function secret() {
  const s = process.env.DEALER_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('DEALER_SESSION_SECRET is missing or shorter than 32 characters.');
  }
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function hmac(body) {
  return b64url(crypto.createHmac('sha256', secret()).update(body).digest());
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA); // keep timing flat on length mismatch
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function signSession({ role, dealerSlug, name, salesperson }) {
  const payload = { role, dealerSlug, name, salesperson: salesperson || null, exp: Date.now() + SESSION_TTL_MS };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}

function verifySessionToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;

  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!timingSafeEqualStr(mac, hmac(body))) return null;

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (payload.role !== ROLE_STAFF && payload.role !== ROLE_DEALER) return null;
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  if (typeof payload.dealerSlug !== 'string' || !payload.dealerSlug) return null;
  if (payload.salesperson != null && typeof payload.salesperson !== 'string') return null;
  return payload;
}

function parseCookies(req) {
  const header = req.headers && req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

// Secure is always set. Browsers treat http://localhost as a trustworthy
// origin, so this still works under `vercel dev`.
function cookieHeader(value, maxAgeSeconds) {
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/api/ko',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

function setSessionCookie(res, session) {
  res.setHeader('Set-Cookie', cookieHeader(signSession(session), Math.floor(SESSION_TTL_MS / 1000)));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookieHeader('', 0));
}

function readSession(req) {
  return verifySessionToken(parseCookies(req)[COOKIE_NAME]);
}

// Guard helpers. Each returns the session, or null after having already sent
// the response — so handlers can `const s = requireSession(req, res); if (!s) return;`
function requireSession(req, res) {
  let session = null;
  try {
    session = readSession(req);
  } catch (err) {
    console.error('session: ' + err.message);
    res.status(500).json({ ok: false, error: 'Sessions are not configured on the server.' });
    return null;
  }
  if (!session) {
    res.status(401).json({ ok: false, error: 'Please sign in again.' });
    return null;
  }
  return session;
}

// Staff can always write. A dealer login can write only if its roster row in
// _dealer-config.js has canWrite, and only ever on its own dealer's board
// (every handler scopes by session.dealerSlug).
function canWrite(session) {
  if (!session) return false;
  if (session.role === ROLE_STAFF) return true;
  return salespersonCanWrite(session.dealerSlug, session.salesperson);
}

function requireStaff(req, res) {
  const session = requireSession(req, res);
  if (!session) return null;
  if (!canWrite(session)) {
    // Dealer users are read-only unless the roster says otherwise. This is the
    // server-side half of that rule — hiding the buttons in the UI is only cosmetic.
    res.status(403).json({ ok: false, error: 'Your account has view-only access.' });
    return null;
  }
  return session;
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  ROLE_STAFF,
  ROLE_DEALER,
  signSession,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  readSession,
  requireSession,
  requireStaff,
  canWrite,
  timingSafeEqualStr,
};
