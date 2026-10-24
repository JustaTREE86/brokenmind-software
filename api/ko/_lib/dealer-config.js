// Roster of who can sign in to each dealer's read-only dashboard.
//
// Add a salesperson later = add a row here, set the matching env var in
// Vercel (Production AND Preview), tell them their password. Nothing else
// needs to change — login.js, session.js and deals.js all read this list.
//
// `salesperson` is identity only: it names who is signed in (so notes and the
// header read correctly) and fills the "assign to" dropdown. It does NOT limit
// what they see — every KO Cars login sees every KO Cars deal, because the
// dealership works the board together.
//
// `canWrite: true` lifts a login off read-only: it can add, edit, restage and
// archive deals, add notes and send invoice requests on its own dealer's board,
// exactly like staff. It stays pinned to that one dealer.
const DEALER_LOGINS = {
  'ko-cars': [
    { passwordEnv: 'KO_CARS_ALAN_PASSWORD', salesperson: 'Alan' },
    { passwordEnv: 'KO_CARS_CHARLIE_PASSWORD', salesperson: 'Charlie' },
    { passwordEnv: 'KO_CARS_JACOB_PASSWORD', salesperson: 'Jacob', canWrite: true },
  ],
};

function loginsFor(slug) {
  return DEALER_LOGINS[slug] || [];
}

function salespeopleFor(slug) {
  return loginsFor(slug).map((l) => l.salesperson).filter(Boolean);
}

function isKnownDealer(slug) {
  return Object.prototype.hasOwnProperty.call(DEALER_LOGINS, slug);
}

// Looked up on every request rather than baked into the cookie, so flipping
// canWrite here takes effect on the next deploy without anyone re-signing in.
function salespersonCanWrite(slug, salesperson) {
  if (!salesperson) return false;
  return loginsFor(slug).some((l) => l.salesperson === salesperson && l.canWrite === true);
}

module.exports = { DEALER_LOGINS, loginsFor, salespeopleFor, isKnownDealer, salespersonCanWrite };
