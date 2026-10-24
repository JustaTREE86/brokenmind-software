// KO Cars finance application endpoint. Email notifications are switched off,
// and nothing is stored, so this only validates the submission. The page then
// hands the applicant a copy to send themselves or to read out over the phone.
const { isValidAUPhone, isValidEmail } = require('./_lib/util');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  const b = req.body || {};
  const supplied = String(b.reference || '').slice(0, 20);
  const reference = /^KO-\d{4}$/.test(supplied) ? supplied : 'KO-' + String(Math.floor(Math.random() * 9000 + 1000));
  if (!String(b.name || '').trim()) return res.status(400).json({ ok: false, error: 'Please enter your name.' });
  if (!isValidAUPhone(b.phone)) return res.status(400).json({ ok: false, error: 'Please enter a valid Australian phone number.' });
  if (!isValidEmail(b.email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  return res.status(503).json({ ok: false, reference,
    error: 'Online submission is not switched on yet. Please call Josh on the number below to finish your application.' });
};
