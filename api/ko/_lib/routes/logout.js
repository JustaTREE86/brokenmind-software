// POST /api/dealer/logout — clears the session cookie.
//
// POST rather than GET so a stray <img> or link prefetch can't sign someone
// out, and so it can't be triggered cross-site.
const { clearSessionCookie } = require('../session');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
};
