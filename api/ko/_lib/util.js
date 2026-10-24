// Shared helpers for the /api serverless functions. CommonJS, no npm deps —
// this project has no build step, so every function must run on plain
// Node.js as shipped by Vercel.
const crypto = require('crypto');

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) {
    // Compare against itself so a length mismatch doesn't short-circuit
    // faster than a real mismatch (rough timing-attack mitigation).
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function isValidAUPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('61')) d = '0' + d.slice(2);
  return /^0[2-478]\d{8}$/.test(d);
}

// GoHighLevel stores every phone in E.164 ("+61412452456") and its contact
// lookup only matches that exact form: searching "0412452456" returns zero
// results even when the contact is sitting right there. Normalise once, here,
// so the lookup, the create and the note all agree on one format. Returns ''
// if the number isn't a valid AU number.
function toE164AU(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('61')) d = '0' + d.slice(2);
  if (!/^0[2-478]\d{8}$/.test(d)) return '';
  return '+61' + d.slice(1);
}

function isValidEmail(v) {
  return /^\S+@\S+\.\S+$/.test(String(v || '').trim());
}

module.exports = { timingSafeEqualStr, isValidAUPhone, isValidEmail, toE164AU };
