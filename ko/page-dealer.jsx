/* global React, BrandLogo, formatMoney */
// =============================================================
// Hidden dealer deal tracker — /dealer/ko-cars
//
// Not part of the public site: no nav link, no footer link, no sitemap entry,
// blocked from indexing (robots.txt + vercel.json X-Robots-Tag + the noindex
// meta swap below).
//
// Two roles, decided server-side by which password was used at login:
//   staff  — broker. Add/edit deals, change stage, add notes, archive.
//   dealer — a KO Cars salesperson. Read-only, but sees the whole board. Each
//            salesperson has their own password (see api/_dealer-config.js)
//            purely so notes and the header name the right person — it does
//            not narrow what they can see. A roster row with canWrite
//            (Jacob) gets the same edit controls as staff on this board.
// The read-only rule is enforced in /api/ko/*; hiding controls here is
// only cosmetic. Never treat this file as a security boundary.
//
// No money is shown on this board. It tracks stage and progress only: neither
// the referral fee payable to KO Cars nor the broker's own commission from
// the lender appears anywhere on the page.
//
// Laid out like a board, not a card wall: one row per deal, grouped by stage,
// with the vehicle as the first and largest column because KO Cars recognise
// deals by the car, not the name. Declined / cancelled / unreachable deals
// leave the active board and live on their own "Declined / Lost" tab.
// =============================================================
const {
  useState: useStateDealer,
  useEffect: useEffectDealer,
  useMemo: useMemoDealer,
  useCallback: useCallbackDealer,
  useRef: useRefDealer,
} = React;

const DEALER_SLUG = 'ko-cars';
const DEALER_REFRESH_MS = 45000; // Auto-refresh cadence for the dealer's view.

// Times are pinned to Brisbane so a deal reads the same for the broker and
// KO Cars regardless of the device's timezone.
const DEALER_TZ = 'Australia/Brisbane';

// Tone drives the badge colour, but the written status is always rendered too,
// so colour is never the only signal.
const DEALER_STATUS_TONE = {
  'New Referral': 'new',
  'Contacting Customer': 'progress',
  'Application Sent': 'progress',
  'Waiting on Customer': 'attention',
  'Documents Required': 'attention',
  'Assessing': 'progress',
  'Submitted to Lender': 'progress',
  'Lender Reviewing': 'progress',
  'Conditional Approval': 'good',
  'Approved': 'good',
  'Settlement Booked': 'good',
  'Settled': 'done',
  'Declined': 'bad',
  'On Hold': 'attention',
  'Unable to Contact': 'attention',
  'Cancelled': 'bad',
};

// Rows are grouped by stage, so "sort by stage" would be meaningless here —
// this only orders the rows inside each group.
const DEALER_SORTS = [
  { id: 'recent', label: 'Most recently updated' },
  { id: 'oldest', label: 'Oldest update' },
  { id: 'vehicle', label: 'Vehicle make and model' },
  { id: 'customer', label: 'Customer name' },
];

// A deal at one of these stages is off the active board — it moves to the
// "Declined / Lost" tab instead of cluttering the live pipeline. Nothing is
// deleted or archived by this: it is only which tab the row appears on, and
// changing the stage back moves it straight back to the active board.
const DEALER_LOST_STATUSES = ['Declined', 'Cancelled', 'Unable to Contact'];

function dealerIsLost(deal) {
  return DEALER_LOST_STATUSES.includes(deal.status);
}

const DEALER_VIEWS = [
  { id: 'active', label: 'Active board' },
  { id: 'lost', label: 'Declined / Lost' },
  { id: 'archived', label: 'Archived' },
];

// Swaps the sitewide <meta name="robots"> to noindex while this page is
// mounted and restores it on unmount. Deliberately local rather than shared
// with page-staff.jsx: these scripts don't export it, and a hidden page should
// not depend on another file's load order for its noindex.
function useDealerNoIndex() {
  useEffectDealer(() => {
    const meta = document.querySelector('meta[name="robots"]');
    const prev = meta ? meta.getAttribute('content') : null;
    if (meta) meta.setAttribute('content', 'noindex, nofollow');
    return () => { if (meta && prev != null) meta.setAttribute('content', prev); };
  }, []);
}

// ---- formatting helpers -------------------------------------------------

function dealerDateTime(iso, joiner) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: DEALER_TZ,
  });
  const time = d.toLocaleTimeString('en-AU', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: DEALER_TZ,
  }).replace(/\s*(am|pm)$/i, (m) => m.toUpperCase());
  return `${date}${joiner}${time}`;
}

function dealerClock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-AU', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: DEALER_TZ,
  }).replace(/\s*(am|pm)$/i, (m) => m.toUpperCase());
}

// "2022 Ford Ranger Wildtrak" — the card's headline.
function dealerVehicleTitle(deal) {
  return [deal.vehicle_year, deal.vehicle_make, deal.vehicle_model, deal.vehicle_variant]
    .filter(Boolean).join(' ');
}

function dealerTelHref(mobile) {
  const cleaned = String(mobile || '').replace(/[^\d+]/g, '');
  return cleaned ? `tel:${cleaned}` : null;
}

async function dealerFetch(url, options) {
  const res = await fetch(url, {
    credentials: 'same-origin', // send the HttpOnly session cookie
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

// ---- small presentational pieces ---------------------------------------

// Which broker is on the deal. A solid, filled badge in its own
// colour per broker so KO Cars can see at a glance who to call. The name is
// always written out; colour is the second signal. Deals saved before the
// broker field existed read as the default (Josh).
const DEALER_BROKER_DEFAULT = 'Josh';
function dealerBrokerOf(deal) {
  return (deal && deal.broker) || DEALER_BROKER_DEFAULT;
}
function dealerBrokerTone(name) {
  return String(name || DEALER_BROKER_DEFAULT).toLowerCase().replace(/[^a-z]/g, '');
}
function DealerBrokerBadge({ broker }) {
  return (
    <span className={`broker-badge broker-${dealerBrokerTone(broker)}`}>
      {broker}
    </span>
  );
}

function DealerStatusBadge({ status, large }) {
  const tone = DEALER_STATUS_TONE[status] || 'new';
  return (
    <span className={`deal-badge tone-${tone}${large ? ' is-large' : ''}`}>{status}</span>
  );
}

function DealerPrivacyNotice() {
  return (
    <p className="deal-privacy">
      This dashboard contains confidential customer information and is provided solely for
      authorised broker and KO Cars staff.
    </p>
  );
}

// ---- login --------------------------------------------------------------

function DealerLoginGate({ onSignedIn }) {
  const [name, setName] = useStateDealer('');
  const [password, setPassword] = useStateDealer('');
  const [error, setError] = useStateDealer('');
  const [busy, setBusy] = useStateDealer(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const { res, json } = await dealerFetch('/api/ko/login', {
        method: 'POST',
        body: JSON.stringify({ name, password, dealer: DEALER_SLUG }),
      });
      if (res.ok && json && json.ok) {
        onSignedIn();
      } else {
        setError((json && json.error) || 'Could not sign you in. Please try again.');
      }
    } catch (err) {
      setError('Network error. Check your connection and try again.');
    }
    setBusy(false);
  };

  return (
    <div className="deal-login-box">
      <BrandLogo light={false} size="sm" />
      <h1 className="h2" style={{ marginTop: 24 }}>KO Cars Deal Tracker</h1>
      <p className="body deal-login-sub">Sign in to view finance deal progress.</p>
      <form onSubmit={submit} className="bp-form" noValidate>
        <div className="bp-field">
          <label htmlFor="deal-name">Your name</label>
          <input id="deal-name" type="text" required autoFocus autoComplete="name"
                 value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="bp-field">
          <label htmlFor="deal-pw">Password</label>
          <input id="deal-pw" type="password" required autoComplete="current-password"
                 value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p role="alert" className="deal-error">{error}</p>}
        <button type="submit" className="btn primary" disabled={busy} style={{ opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <DealerPrivacyNotice />
    </div>
  );
}

// ---- add / edit form ----------------------------------------------------

const DEALER_EMPTY_FORM = {
  customer_name: '', customer_mobile: '', customer_email: '',
  vehicle_year: '', vehicle_make: '', vehicle_model: '', vehicle_variant: '',
  vehicle_registration: '', vehicle_stock_number: '', vehicle_price: '',
  status: 'New Referral', salesperson: '', broker: '', initial_note: '',
};

// ---- quick entry --------------------------------------------------------
//
// Josh types one line and this pulls it apart. It is deliberately a plain
// heuristic, not a cleverness contest: whatever it works out is written
// straight into the visible form fields, so a wrong guess is obvious on
// screen and correctable before saving. Nothing is saved from the raw text.

// Makes seen across car, truck, bike and equipment finance. Order matters:
// longer names first so "Land Rover" wins before "Rover" style prefixes and
// "Mercedes-Benz" before "Mercedes".
const DEALER_MAKES = [
  'Mercedes-Benz', 'Harley-Davidson', 'Land Rover', 'Range Rover', 'Alfa Romeo',
  'Western Star', 'New Holland', 'John Deere', 'Great Wall', 'SsangYong',
  'Freightliner', 'Volkswagen', 'Mitsubishi', 'Chevrolet', 'Caterpillar',
  'Kenworth', 'Mercedes', 'Porsche', 'Polestar', 'Kawasaki', 'Triumph',
  'Aprilia', 'Peugeot', 'Renault', 'Hyundai', 'Genesis', 'Bobcat', 'Komatsu',
  'Toyota', 'Subaru', 'Suzuki', 'Nissan', 'Holden', 'Jaguar', 'Ducati',
  'Yamaha', 'Kubota', 'Scania', 'Iveco', 'Lexus', 'Skoda', 'Volvo', 'Tesla',
  'Honda', 'Mazda', 'Isuzu', 'Cupra', 'Chery', 'Haval', 'Dodge', 'Harley',
  'Rover', 'Mini', 'Fiat', 'Jeep', 'Audi', 'Ford', 'Opel', 'Seat', 'Hino',
  'Fuso', 'Mack', 'Ram', 'BMW', 'Kia', 'MG', 'VW', 'GWM', 'LDV', 'BYD', 'KTM',
];

// Shorthand Josh actually types, mapped to how it should be stored.
const DEALER_MAKE_ALIASES = {
  vw: 'Volkswagen',
  mercedes: 'Mercedes-Benz',
  merc: 'Mercedes-Benz',
  harley: 'Harley-Davidson',
  'great wall': 'GWM',
  chevy: 'Chevrolet',
};

const DEALER_RE_EMAIL = /[^\s,;<>()]+@[^\s,;<>()]+\.[A-Za-z]{2,}/;
// AU mobile and landline, tolerating spaces, dashes, brackets and +61.
const DEALER_RE_PHONE = /(?:\+?61[\s.-]?|\b0)[2-478](?:[\s.-]?\d){8}\b/;
const DEALER_RE_MONEY = /\$\s?\d[\d,]*(?:\.\d{1,2})?[kK]?|\b\d[\d,]*(?:\.\d{1,2})?[kK]\b/;
const DEALER_RE_YEAR = /\b(?:19[89]\d|20[0-3]\d)\b/;
const DEALER_RE_BARE_PRICE = /\b\d[\d,]{2,}(?:\.\d{1,2})?\b/;

// Cases one hyphen-separated part. Vehicle names break the usual rules:
// "c200" and "v6" are codes that want full caps, "LS" and "U" are already
// right, and "ranger" is an ordinary word.
function dealerTitleCasePart(p) {
  if (!p) return p;
  if (/\d/.test(p)) return p.toUpperCase();
  if (p === p.toUpperCase() && p.length <= 3) return p;
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

function dealerTitleCase(s) {
  return String(s).replace(/\S+/g, (w) => w.split('-').map(dealerTitleCasePart).join('-'));
}

// "45k" -> 45000, "$47,990" -> 47990
function dealerParseMoney(raw) {
  let s = String(raw).replace(/[$,\s]/g, '');
  let mult = 1;
  if (/[kK]$/.test(s)) { mult = 1000; s = s.slice(0, -1); }
  const n = parseFloat(s);
  if (!isFinite(n) || n <= 0) return '';
  return String(Math.round(n * mult));
}

function dealerLooksLikeName(s) {
  const t = String(s).trim();
  if (!t || /\d|@/.test(t)) return false;
  const words = t.split(/\s+/);
  return words.length >= 1 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z'’.-]*$/.test(w));
}

// Pulls make/model/variant out of one phrase, e.g. "2022 ford ranger wildtrak".
function dealerParseVehiclePhrase(phrase) {
  const out = { vehicle_make: '', vehicle_model: '', vehicle_variant: '' };
  let rest = String(phrase).trim();
  if (!rest) return out;

  let hit = null;
  for (const make of DEALER_MAKES) {
    const re = new RegExp('(^|\\s)' + make.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '(\\s|$)', 'i');
    const m = rest.match(re);
    if (m) { hit = { make, index: m.index + m[1].length, length: make.length }; break; }
  }
  if (!hit) return out;

  const canonical = DEALER_MAKE_ALIASES[hit.make.toLowerCase()] || hit.make;
  out.vehicle_make = canonical;

  const after = rest.slice(hit.index + hit.length).trim();
  if (after) {
    const words = after.split(/\s+/);
    out.vehicle_model = dealerTitleCase(words[0]);
    if (words.length > 1) out.vehicle_variant = dealerTitleCase(words.slice(1).join(' '));
  }
  return out;
}

// Text in, form fields out. Returns only the keys it is confident about, so
// the caller can leave anything else exactly as the user left it.
function dealerParseEntry(text) {
  const found = {};
  let rest = ' ' + String(text || '') + ' ';

  const take = (re, fn) => {
    const m = rest.match(re);
    if (!m) return null;
    rest = rest.slice(0, m.index) + ' , ' + rest.slice(m.index + m[0].length);
    if (fn) fn(m[0]);
    return m[0];
  };

  // Order matters. Email holds no digits worth confusing; phone before any
  // money rule so a 10-digit mobile is never read as a price; year before the
  // bare-number price rule so "2022" is a year, not $2,022.
  take(DEALER_RE_EMAIL, (v) => { found.customer_email = v.trim().toLowerCase(); });
  take(DEALER_RE_PHONE, (v) => { found.customer_mobile = v.trim().replace(/[.\-]/g, ' ').replace(/\s+/g, ' '); });
  take(DEALER_RE_MONEY, (v) => { found.vehicle_price = dealerParseMoney(v); });
  take(DEALER_RE_YEAR, (v) => { found.vehicle_year = v; });
  if (!found.vehicle_price) take(DEALER_RE_BARE_PRICE, (v) => { found.vehicle_price = dealerParseMoney(v); });

  // Whatever survives splits on the separators people actually type.
  const chunks = rest.split(/[,;|\n]+|\s+-\s+/).map((c) => c.trim()).filter(Boolean);

  // The chunk naming a make is the vehicle; the rest are name and notes.
  let vehicleChunk = -1;
  for (let i = 0; i < chunks.length; i++) {
    const v = dealerParseVehiclePhrase(chunks[i]);
    if (v.vehicle_make) {
      Object.assign(found, v);
      vehicleChunk = i;
      break;
    }
  }

  const leftovers = chunks.filter((_, i) => i !== vehicleChunk);

  // First name-shaped chunk is the customer; everything after is notes.
  let nameChunk = -1;
  for (let i = 0; i < leftovers.length; i++) {
    if (dealerLooksLikeName(leftovers[i])) { nameChunk = i; break; }
  }
  if (nameChunk >= 0) found.customer_name = dealerTitleCase(leftovers[nameChunk]);

  const notes = leftovers.filter((_, i) => i !== nameChunk).join('. ').trim();
  if (notes) found.initial_note = notes;

  return found;
}

// One-line summary of what the parser understood, for the confirm strip.
function dealerVehicleFromFields(f) {
  return [f.vehicle_year, f.vehicle_make, f.vehicle_model, f.vehicle_variant]
    .filter(Boolean).join(' ').trim();
}

// Sentinel for the 'Archive' choice in the Edit deal stage dropdown. Never
// sent to the server as a status.
const DEALER_ARCHIVE_OPTION = '__archive__';

function DealerDealForm({ deal, statuses, salespeople, brokers, onClose, onSaved }) {
  const editing = Boolean(deal);
  const [f, setF] = useStateDealer(() => {
    if (!deal) return DEALER_EMPTY_FORM;
    return {
      ...DEALER_EMPTY_FORM,
      ...Object.keys(DEALER_EMPTY_FORM).reduce((acc, k) => {
        acc[k] = deal[k] === null || deal[k] === undefined ? '' : String(deal[k]);
        return acc;
      }, {}),
      status: deal.status,
      broker: dealerBrokerOf(deal),
    };
  });
  const [error, setError] = useStateDealer('');
  const [busy, setBusy] = useStateDealer(false);
  const [quick, setQuick] = useStateDealer('');
  // Editing an existing deal goes straight to the fields; there is nothing to
  // parse and the quick box would only get in the way.
  const [showFields, setShowFields] = useStateDealer(editing);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  // Re-parses on every keystroke and writes into the same fields the form
  // submits. Only keys the parser is confident about are overwritten, and the
  // stage dropdown is never touched.
  const onQuick = (e) => {
    const text = e.target.value;
    setQuick(text);
    const parsed = dealerParseEntry(text);
    setF((s) => ({ ...DEALER_EMPTY_FORM, status: s.status, ...parsed }));
  };

  // The server validates all of this again; this pass is only so the user gets
  // an answer without waiting for a round trip.
  const validate = () => {
    if (!f.customer_name.trim()) return 'Please enter the customer’s full name.';
    if (!f.customer_mobile.trim() && !f.customer_email.trim()) {
      return 'Please enter a customer mobile or email address.';
    }
    if (!f.vehicle_make.trim()) return 'Please enter the vehicle make.';
    if (!f.vehicle_model.trim()) return 'Please enter the vehicle model.';
    if (!f.status) return 'Please choose the current stage.';
    return '';
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      // The missing field is useless if it's behind the toggle.
      setShowFields(true);
      return;
    }
    setError('');
    setBusy(true);
    try {
      // On edit the server ignores initial_note — the opening note already
      // exists and history is append-only.
      // Picking 'Archive' in the stage dropdown is the Archive button's
      // change (archived: true on the same PATCH /api/ko/deals), so the
      // stage itself stays as it was and no new status is invented.
      const archiving = editing && f.status === DEALER_ARCHIVE_OPTION;
      const payload = editing
        ? (archiving ? { ...f, status: deal.status, id: deal.id, archived: true } : { ...f, id: deal.id })
        : f;
      const { res, json } = await dealerFetch('/api/ko/deals', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      if (res.ok && json && json.ok) {
        onSaved();
      } else {
        setError((json && json.error) || 'The deal could not be saved.');
      }
    } catch (err) {
      setError('Network error. Your details below are unchanged, please try again.');
    }
    setBusy(false);
  };

  return (
    <div className="deal-modal-backdrop" role="dialog" aria-modal="true" aria-label={editing ? 'Edit deal' : 'Add deal'}>
      <div className="deal-modal">
        <div className="deal-modal-head">
          <h2 className="h3">{editing ? 'Edit deal' : 'Add a deal'}</h2>
          <button type="button" className="deal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={submit} className="bp-form" noValidate>
          {!editing && (
            <div className="deal-quick">
              <label htmlFor="d-quick">Type the deal</label>
              <textarea id="d-quick" rows={3} value={quick} onChange={onQuick} autoFocus
                        placeholder="2022 Ford Ranger Wildtrak, John Smith, 0400 123 456, john@email.com, $45000, waiting on payslips" />
              <p className="deal-hint">
                Car, name, phone, email, price, notes. Any order, commas between them. Everything below fills in as you type.
              </p>

              <div className="deal-parsed" aria-live="polite">
                <p className="deal-parsed-line">
                  <span className="deal-parsed-key">Vehicle</span>
                  <span className={dealerVehicleFromFields(f) ? 'deal-parsed-val is-set' : 'deal-parsed-val'}>
                    {dealerVehicleFromFields(f) || 'not picked up yet'}
                  </span>
                </p>
                <p className="deal-parsed-line">
                  <span className="deal-parsed-key">Customer</span>
                  <span className={f.customer_name ? 'deal-parsed-val is-set' : 'deal-parsed-val'}>
                    {f.customer_name || 'not picked up yet'}
                  </span>
                </p>
                <p className="deal-parsed-line">
                  <span className="deal-parsed-key">Contact</span>
                  <span className={(f.customer_mobile || f.customer_email) ? 'deal-parsed-val is-set' : 'deal-parsed-val'}>
                    {[f.customer_mobile, f.customer_email].filter(Boolean).join('  ·  ') || 'not picked up yet'}
                  </span>
                </p>
                {f.vehicle_price && (
                  <p className="deal-parsed-line">
                    <span className="deal-parsed-key">Price</span>
                    <span className="deal-parsed-val is-set">${formatMoney(f.vehicle_price)}</span>
                  </p>
                )}
                {f.initial_note && (
                  <p className="deal-parsed-line">
                    <span className="deal-parsed-key">Note</span>
                    <span className="deal-parsed-val is-set">{f.initial_note}</span>
                  </p>
                )}
              </div>

              <div className="bp-field">
                <label htmlFor="d-status-quick">Current stage</label>
                <select id="d-status-quick" className="cr-select" value={f.status} onChange={set('status')}>
                  {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <button type="button" className="deal-toggle-fields" onClick={() => setShowFields((v) => !v)}>
                {showFields ? 'Hide the detail fields' : 'Something wrong? Fix the details'}
              </button>
            </div>
          )}

          <div hidden={!showFields}>
          <p className="deal-form-legend">Vehicle</p>
          <div className="bp-row">
            <div className="bp-field">
              <label htmlFor="d-year">Year</label>
              <input id="d-year" type="number" min="1900" max="2100" step="1" value={f.vehicle_year} onChange={set('vehicle_year')} placeholder="2022" />
            </div>
            <div className="bp-field">
              <label htmlFor="d-make">Make <span aria-hidden="true">*</span></label>
              <input id="d-make" type="text" required value={f.vehicle_make} onChange={set('vehicle_make')} placeholder="Ford" />
            </div>
          </div>
          <div className="bp-row">
            <div className="bp-field">
              <label htmlFor="d-model">Model <span aria-hidden="true">*</span></label>
              <input id="d-model" type="text" required value={f.vehicle_model} onChange={set('vehicle_model')} placeholder="Ranger" />
            </div>
            <div className="bp-field">
              <label htmlFor="d-variant">Variant</label>
              <input id="d-variant" type="text" value={f.vehicle_variant} onChange={set('vehicle_variant')} placeholder="Wildtrak" />
            </div>
          </div>
          <div className="bp-row">
            <div className="bp-field">
              <label htmlFor="d-rego">Registration</label>
              <input id="d-rego" type="text" value={f.vehicle_registration} onChange={set('vehicle_registration')} placeholder="ABC123" />
            </div>
            <div className="bp-field">
              <label htmlFor="d-stock">Stock number</label>
              <input id="d-stock" type="text" value={f.vehicle_stock_number} onChange={set('vehicle_stock_number')} />
            </div>
          </div>
          <div className="bp-field">
            <label htmlFor="d-price">Vehicle price</label>
            <input id="d-price" type="number" min="0" step="1" value={f.vehicle_price} onChange={set('vehicle_price')} placeholder="$" />
          </div>

          <p className="deal-form-legend">Customer</p>
          <div className="bp-field">
            <label htmlFor="d-name">Full name <span aria-hidden="true">*</span></label>
            <input id="d-name" type="text" required value={f.customer_name} onChange={set('customer_name')} />
          </div>
          <div className="bp-row">
            <div className="bp-field">
              <label htmlFor="d-mobile">Mobile</label>
              <input id="d-mobile" type="tel" value={f.customer_mobile} onChange={set('customer_mobile')} placeholder="0400 000 000" />
            </div>
            <div className="bp-field">
              <label htmlFor="d-email">Email</label>
              <input id="d-email" type="email" value={f.customer_email} onChange={set('customer_email')} placeholder="customer@email.com" />
            </div>
          </div>
          <p className="deal-hint">Enter at least one of mobile or email.</p>

          <p className="deal-form-legend">Progress</p>
          {editing && (
            <div className="bp-field">
              <label htmlFor="d-status">Current stage <span aria-hidden="true">*</span></label>
              <select id="d-status" className="cr-select" required value={f.status} onChange={set('status')}>
                {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                {!deal.archived && <option value={DEALER_ARCHIVE_OPTION}>Archive</option>}
              </select>
            </div>
          )}

          {!editing && (
            <div className="bp-field">
              <label htmlFor="d-note">Initial note</label>
              <textarea id="d-note" rows={3} value={f.initial_note} onChange={set('initial_note')}
                        placeholder="Referral received from KO Cars. Calling the customer today." />
            </div>
          )}

          {brokers.length > 0 && (
            <div className="bp-field">
              <label htmlFor="d-broker">Broker</label>
              <select id="d-broker" className="cr-select" value={f.broker || DEALER_BROKER_DEFAULT} onChange={set('broker')}>
                {brokers.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <p className="deal-hint">Which broker is running this deal. Shown as a coloured badge on the board.</p>
            </div>
          )}

          {salespeople.length > 0 && (
            <div className="bp-field">
              <label htmlFor="d-salesperson">Salesperson</label>
              <select id="d-salesperson" className="cr-select" value={f.salesperson} onChange={set('salesperson')}>
                <option value="">Unassigned</option>
                {salespeople.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <p className="deal-hint">Who owns this deal at KO Cars. Everyone at KO Cars sees every deal either way.</p>
            </div>
          )}

          <div className="bp-field">
            <label htmlFor="d-dealer">Dealer</label>
            <input id="d-dealer" type="text" value="KO Cars" readOnly disabled />
          </div>
          </div>

          {error && <p role="alert" className="deal-error">{error}</p>}

          <div className="deal-form-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy} style={{ opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add deal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- invoice request ----------------------------------------------------
//
// "Request invoice" on a deal. Pulls the car off the KO Cars website by stock
// number, rego, VIN or listing link, lets Josh fill in the buyer's invoice
// details, and emails KO Cars (Josh cc'd). The buyer's DOB and licence go in
// the email only: nothing here is saved to the deal except a one-line note.

const DEALER_LICENCE_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

function dealerInvoiceMessage(deal) {
  const first = String(deal.customer_name || '').trim().split(/\s+/)[0] || 'the customer';
  const where = {
    'Conditional Approval': `Good news, we've got ${first}'s finance conditionally approved so we're ready to get this one moving.`,
    'Approved': `Good news, ${first}'s finance is approved so we're ready to get this one moving.`,
    'Settlement Booked': `${first}'s finance is approved and we're booking settlement.`,
  }[deal.status] || `We're getting ${first}'s finance ready to go.`;
  return `Hey KO team,\n\nHope you're all going well! ${where}\n\nCan you please put together an invoice made out to the following:`;
}

function DealerInvoiceRequest({ deal, onClose, onSent }) {
  const [message, setMessage] = useStateDealer(() => dealerInvoiceMessage(deal));
  const [buyer, setBuyer] = useStateDealer({
    name: deal.customer_name || '', address: '', dob: '',
    licence_no: '', licence_state: 'QLD', licence_expiry: '',
    mobile: deal.customer_mobile || '', email: deal.customer_email || '',
  });
  const [vehicle, setVehicle] = useStateDealer({
    title: dealerVehicleTitle(deal), stock: deal.vehicle_stock_number || '', vin: '',
    rego: deal.vehicle_registration || '', colour: '', odometer: '',
    price: deal.vehicle_price !== null && deal.vehicle_price !== undefined ? `$${formatMoney(deal.vehicle_price)}` : '',
  });
  const [finance, setFinance] = useStateDealer({ amount: '', deposit: '', trade_in: '', lender: '' });

  const [lookup, setLookup] = useStateDealer(deal.vehicle_stock_number || deal.vehicle_registration || '');
  const [lookupState, setLookupState] = useStateDealer({ busy: false, note: '', candidates: [], listing: '' });

  const [busy, setBusy] = useStateDealer(false);
  const [error, setError] = useStateDealer('');
  const [fallback, setFallback] = useStateDealer(null);

  const setIn = (setter, k) => (e) => setter((s) => ({ ...s, [k]: e.target.value }));

  const fetchVehicle = useCallbackDealer(async (q) => {
    setLookupState((s) => ({ ...s, busy: true, note: '', candidates: [] }));
    const params = new URLSearchParams({
      action: 'vehicle', q: q || '',
      year: deal.vehicle_year || '', make: deal.vehicle_make || '', model: deal.vehicle_model || '',
    });
    try {
      const { res, json } = await dealerFetch(`/api/ko/deals?${params}`);
      if (res.ok && json && json.ok && json.vehicle) {
        const v = json.vehicle;
        setVehicle({
          title: v.title, stock: v.stock, vin: v.vin, rego: v.rego,
          colour: v.colour, odometer: v.odometer, price: v.price,
        });
        setLookupState({ busy: false, note: 'Filled in from the KO Cars website. Check it before sending.', candidates: [], listing: v.url });
      } else if (res.ok && json && json.ok) {
        const found = json.candidates || [];
        setLookupState({
          busy: false,
          note: json.searched
            ? `Nothing on the KO Cars website matches "${json.searched}". ${found.length ? 'Pick the car below, or fill it in by hand.' : 'Fill it in by hand.'}`
            : (found.length ? 'Pick the car from KO Cars stock below.' : 'No matching car on the KO Cars website. Fill it in by hand.'),
          candidates: found,
          listing: '',
        });
      } else {
        setLookupState({ busy: false, note: (json && json.error) || 'Lookup failed. Fill the vehicle in by hand.', candidates: [], listing: '' });
      }
    } catch (err) {
      setLookupState({ busy: false, note: 'Network error. Fill the vehicle in by hand.', candidates: [], listing: '' });
    }
  }, [deal]);

  // Look the car up as soon as the form opens: by stock/rego if the deal has
  // one, otherwise offer KO Cars stock that matches the deal's make and model.
  useEffectDealer(() => { fetchVehicle(lookup); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!buyer.name.trim()) return setError('Please enter the buyer’s full legal name.');
    if (!buyer.address.trim()) return setError('Please enter the buyer’s address.');
    if (!vehicle.title.trim()) return setError('Please enter the vehicle, or fetch it from the KO Cars website.');
    setError('');
    setFallback(null);
    setBusy(true);
    try {
      const { res, json } = await dealerFetch('/api/ko/deals?action=invoice-request', {
        method: 'POST',
        body: JSON.stringify({ id: deal.id, message, buyer, vehicle, finance }),
      });
      if (res.ok && json && json.ok) {
        onSent();
        return;
      }
      setError((json && json.error) || 'The invoice request could not be prepared.');
      if (json && json.fallback) setFallback(json.fallback);
    } catch (err) {
      setError('Network error. Nothing was sent, please try again.');
    }
    setBusy(false);
  };

  const field = (id, label, value, onChange, props = {}) => (
    <div className="bp-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" value={value} onChange={onChange} {...props} />
    </div>
  );

  return (
    <div className="deal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Request invoice from KO Cars">
      <div className="deal-modal">
        <div className="deal-modal-head">
          <h2 className="h3">Request invoice from KO Cars</h2>
          <button type="button" className="deal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={submit} className="bp-form" noValidate>
          <p className="deal-form-legend">Vehicle from the KO Cars website</p>
          <div className="deal-lookup">
            <div className="bp-field">
              <label htmlFor="inv-lookup">Stock number, rego, VIN or listing link</label>
              <input id="inv-lookup" type="text" value={lookup} onChange={(e) => setLookup(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fetchVehicle(lookup); } }}
                     placeholder="445" />
            </div>
            <button type="button" className="btn ghost deal-btn-sm" disabled={lookupState.busy}
                    onClick={() => fetchVehicle(lookup)}>
              {lookupState.busy ? 'Searching…' : 'Fetch from website'}
            </button>
          </div>
          {lookupState.busy && <p className="deal-hint">Reading the KO Cars website…</p>}
          {lookupState.note && (
            <p className="deal-hint" aria-live="polite">
              {lookupState.note}
              {lookupState.listing && <> <a href={lookupState.listing} target="_blank" rel="noopener noreferrer">View listing</a></>}
            </p>
          )}
          {lookupState.candidates.length > 0 && (
            <ul className="deal-candidates">
              {lookupState.candidates.map((c) => (
                <li key={c.url}>
                  <button type="button" className="deal-candidate" onClick={() => { setLookup(c.url); fetchVehicle(c.url); }}>
                    <span>{c.title}</span><span className="deal-candidate-price">{c.price}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {field('inv-v-title', 'Vehicle *', vehicle.title, setIn(setVehicle, 'title'))}
          <div className="bp-row">
            {field('inv-v-stock', 'Stock #', vehicle.stock, setIn(setVehicle, 'stock'))}
            {field('inv-v-rego', 'Rego', vehicle.rego, setIn(setVehicle, 'rego'))}
          </div>
          <div className="bp-row">
            {field('inv-v-vin', 'VIN', vehicle.vin, setIn(setVehicle, 'vin'))}
            {field('inv-v-colour', 'Colour', vehicle.colour, setIn(setVehicle, 'colour'))}
          </div>
          <div className="bp-row">
            {field('inv-v-odo', 'Odometer (km)', vehicle.odometer, setIn(setVehicle, 'odometer'))}
            {field('inv-v-price', 'Price', vehicle.price, setIn(setVehicle, 'price'))}
          </div>

          <p className="deal-form-legend">Invoice &amp; delivery to</p>
          {field('inv-b-name', 'Full legal name *', buyer.name, setIn(setBuyer, 'name'), { autoComplete: 'off' })}
          {field('inv-b-address', 'Address *', buyer.address, setIn(setBuyer, 'address'), { autoComplete: 'off', placeholder: '14 Example Court, Logan Central QLD 4114' })}
          <div className="bp-row">
            {field('inv-b-dob', 'Date of birth', buyer.dob, setIn(setBuyer, 'dob'), { autoComplete: 'off', placeholder: 'DD/MM/YYYY' })}
            {field('inv-b-lic-exp', 'Licence expiry', buyer.licence_expiry, setIn(setBuyer, 'licence_expiry'), { autoComplete: 'off', placeholder: 'DD/MM/YYYY' })}
          </div>
          <div className="bp-row">
            {field('inv-b-lic', 'Driver’s licence no.', buyer.licence_no, setIn(setBuyer, 'licence_no'), { autoComplete: 'off' })}
            <div className="bp-field">
              <label htmlFor="inv-b-lic-state">Licence state</label>
              <select id="inv-b-lic-state" className="cr-select" value={buyer.licence_state} onChange={setIn(setBuyer, 'licence_state')}>
                {DEALER_LICENCE_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="bp-row">
            {field('inv-b-mobile', 'Mobile', buyer.mobile, setIn(setBuyer, 'mobile'), { type: 'tel' })}
            {field('inv-b-email', 'Email', buyer.email, setIn(setBuyer, 'email'), { type: 'email' })}
          </div>

          <p className="deal-form-legend">Finance</p>
          <div className="bp-row">
            {field('inv-f-amount', 'Finance amount', finance.amount, setIn(setFinance, 'amount'), { placeholder: '$20,140.00' })}
            {field('inv-f-deposit', 'Deposit', finance.deposit, setIn(setFinance, 'deposit'))}
          </div>
          <div className="bp-row">
            {field('inv-f-trade', 'Trade-in', finance.trade_in, setIn(setFinance, 'trade_in'))}
            {field('inv-f-lender', 'Lender', finance.lender, setIn(setFinance, 'lender'))}
          </div>

          <p className="deal-form-legend">Message</p>
          <div className="bp-field">
            <label htmlFor="inv-message">Opens the email</label>
            <textarea id="inv-message" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <p className="deal-hint">Goes to ko-cars@hotmail.com with you cc’d. Replies come to you. DOB and licence are not saved on the tracker.</p>

          {error && <p role="alert" className="deal-error">{error}</p>}
          {fallback && (
            <div className="bp-field">
              <label htmlFor="inv-fallback">To: {fallback.to} · Subject: {fallback.subject}</label>
              <textarea id="inv-fallback" rows={10} readOnly value={fallback.text} onFocus={(e) => e.target.select()} />
            </div>
          )}

          <div className="deal-form-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy} style={{ opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Sending…' : 'Send to KO Cars'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- one board row ------------------------------------------------------
//
// Renders as two <tr>s: the row itself, and the detail panel underneath it
// when the row is open. Clicking the vehicle opens the detail — the whole row
// is deliberately not a click target, so the phone and email links inside it
// stay ordinary links.

function DealerDealRow({ deal, canEdit, statuses, brokers, open, onToggle, onChanged, onEdit, onInvoice }) {
  const [noteText, setNoteText] = useStateDealer('');
  const [busy, setBusy] = useStateDealer(false);
  const [error, setError] = useStateDealer('');

  const notes = deal.deal_notes || [];
  const latest = notes[0];
  const title = dealerVehicleTitle(deal);
  const tone = DEALER_STATUS_TONE[deal.status] || 'new';

  const addNote = async (e) => {
    e.preventDefault();
    if (busy || !noteText.trim()) return;
    setBusy(true);
    setError('');
    try {
      const { res, json } = await dealerFetch('/api/ko/notes', {
        method: 'POST',
        body: JSON.stringify({ deal_id: deal.id, note: noteText }),
      });
      if (res.ok && json && json.ok) {
        setNoteText('');
        onChanged();
      } else {
        setError((json && json.error) || 'The note could not be saved.');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    }
    setBusy(false);
  };

  const patchDeal = async (patch) => {
    setBusy(true);
    setError('');
    let ok = false;
    try {
      const { res, json } = await dealerFetch('/api/ko/deals', {
        method: 'PATCH',
        body: JSON.stringify({ id: deal.id, ...patch }),
      });
      if (res.ok && json && json.ok) {
        ok = true;
        onChanged();
        // The stage saved but KO Cars were not told. Say so, loudly enough
        // that Josh can ring them instead.
        if (json.emailed === false) setError('Stage saved, but the email to KO Cars did not send. Let them know directly.');
      }
      else setError((json && json.error) || 'That change could not be saved.');
    } catch (err) {
      setError('Network error. Please try again.');
    }
    setBusy(false);
    return ok;
  };

  return (
    <React.Fragment>
      <tr className={`board-row${open ? ' is-open' : ''}`}>
        {/* Vehicle first and largest — KO Cars identify deals by the car. */}
        <td className="board-cell board-cell-vehicle" data-label="Vehicle">
          <button type="button" className="board-vehicle-btn" aria-expanded={open}
                  onClick={onToggle}>
            <span className="board-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
            <span className="board-vehicle">{title || 'Vehicle to be confirmed'}</span>
          </button>
          <span className="board-vehicle-sub">
            {deal.vehicle_price !== null && deal.vehicle_price !== undefined && (
              <span>${formatMoney(deal.vehicle_price)}</span>
            )}
            {deal.vehicle_registration && <span>{deal.vehicle_registration}</span>}
            {deal.archived && <span className="deal-badge tone-archived">Archived</span>}
          </span>
        </td>

        <td className="board-cell board-cell-broker" data-label="Broker">
          {canEdit && brokers.length > 0 ? (
            <select className={`broker-select broker-${dealerBrokerTone(dealerBrokerOf(deal))}`}
                    value={dealerBrokerOf(deal)} disabled={busy}
                    aria-label={`Broker for ${title || deal.customer_name}`}
                    onChange={(e) => patchDeal({ broker: e.target.value })}>
              {brokers.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          ) : (
            <DealerBrokerBadge broker={dealerBrokerOf(deal)} />
          )}
        </td>

        <td className="board-cell board-cell-name" data-label="Customer">{deal.customer_name}</td>

        <td className="board-cell board-cell-phone" data-label="Phone">
          {deal.customer_mobile
            ? <a href={dealerTelHref(deal.customer_mobile)}>{deal.customer_mobile}</a>
            : <span className="board-blank">—</span>}
        </td>

        <td className="board-cell board-cell-note" data-label="Latest note">
          {latest ? (
            <React.Fragment>
              <span className="board-note-text">{latest.note}</span>
              <span className="board-note-when">
                {dealerDateTime(latest.created_at, ', ')}{latest.created_by ? ` · ${latest.created_by}` : ''}
              </span>
            </React.Fragment>
          ) : (
            <span className="board-blank">No notes yet</span>
          )}
        </td>

        {/* Staff change the stage straight from the board; everyone else reads
            it. The written status is always shown, colour is only a second
            signal. The server enforces the read-only rule either way. */}
        <td className="board-cell board-cell-status" data-label="Status">
          {canEdit ? (
            <select className={`board-status-select tone-${tone}`} value={deal.status} disabled={busy}
                    aria-label={`Stage for ${title || deal.customer_name}`}
                    onChange={(e) => patchDeal({ status: e.target.value })}>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <DealerStatusBadge status={deal.status} />
          )}
        </td>
      </tr>

      {open && (
        <tr className="board-detail-row">
          <td className="board-detail-cell" colSpan={6}>
            <div className="board-detail">
              {/* Email lives here rather than in a board column — it is the
                  contact method nobody scans the board for, and the column it
                  used to occupy was squeezing the status out of shape. */}
              <div className="board-detail-facts">
                {deal.customer_email && (
                  <p className="deal-updated">
                    Email: <a href={`mailto:${deal.customer_email}`}>{deal.customer_email}</a>
                  </p>
                )}
                <p className="deal-updated">Last updated: {dealerDateTime(deal.updated_at, ' at ')}</p>
                {deal.settled_at && (
                  <p className="deal-updated">Settled: {dealerDateTime(deal.settled_at, ' at ')}</p>
                )}
                {deal.salesperson && <p className="deal-updated">Salesperson: {deal.salesperson}</p>}
                {deal.vehicle_stock_number && <p className="deal-updated">Stock #: {deal.vehicle_stock_number}</p>}
              </div>

              {notes.length > 0 ? (
                <ol className="deal-history">
                  {notes.map((n) => (
                    <li key={n.id}>
                      <p className="deal-note-when">{dealerDateTime(n.created_at, ', ')}</p>
                      <p className="deal-note-text">{n.note}</p>
                      {n.created_by && <p className="deal-note-who">by {n.created_by}</p>}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="deal-note-empty">No notes on this deal yet.</p>
              )}

              {error && <p role="alert" className="deal-error">{error}</p>}

              {/* Staff-only controls. The server enforces this too — a dealer
                  session is rejected by /api/ko/* even if these were
                  forced into the DOM. */}
              {canEdit && (
                <div className="deal-staff-tools">
                  <form onSubmit={addNote} className="deal-note-form">
                    <label htmlFor={`note-${deal.id}`} className="deal-label">Add an update</label>
                    <textarea id={`note-${deal.id}`} rows={2} value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                              placeholder="Customer has supplied bank statements…" />
                    <button type="submit" className="btn primary deal-btn-sm"
                            disabled={busy || !noteText.trim()}>
                      {busy ? 'Saving…' : 'Add note'}
                    </button>
                  </form>

                  <div className="deal-staff-row">
                    <button type="button" className="btn primary deal-btn-sm" onClick={() => onInvoice(deal)}>Request invoice</button>
                    <button type="button" className="btn ghost deal-btn-sm" onClick={() => onEdit(deal)}>Edit deal</button>
                    <button type="button" className="btn ghost deal-btn-sm" disabled={busy}
                            onClick={() => patchDeal({ archived: !deal.archived })}>
                      {deal.archived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}

      {/* A failed stage change happens in the row, not the detail panel, so the
          message has to be reachable without opening it. */}
      {error && !open && (
        <tr className="board-detail-row">
          <td className="board-detail-cell" colSpan={6}>
            <p role="alert" className="deal-error">{error}</p>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

// ---- one stage group ----------------------------------------------------
//
// The board's equivalent of a Monday group: a coloured stage header with a
// count, and the rows for that stage underneath. Column widths are fixed in
// CSS so every group's columns line up down the page.

function DealerBoardGroup({ status, deals, collapsed, onToggleGroup, openIds, onToggleRow, ...rowProps }) {
  const tone = DEALER_STATUS_TONE[status] || 'new';
  const headingId = `group-${status.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <section className="board-group" aria-labelledby={headingId}>
      <h2 className={`board-group-head tone-${tone}`}>
        <button type="button" className="board-group-btn" id={headingId}
                aria-expanded={!collapsed} onClick={() => onToggleGroup(status)}>
          <span className="board-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          <span className="board-group-name">{status}</span>
          <span className="board-group-count">{deals.length}</span>
        </button>
      </h2>

      {!collapsed && (
        <div className="board-table-wrap">
          <table className="board-table">
            <thead>
              <tr>
                <th scope="col" className="board-cell-vehicle">Vehicle</th>
                <th scope="col" className="board-cell-broker">Broker</th>
                <th scope="col" className="board-cell-name">Customer</th>
                <th scope="col" className="board-cell-phone">Phone</th>
                <th scope="col" className="board-cell-note">Latest note</th>
                <th scope="col" className="board-cell-status">Status</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <DealerDealRow key={d.id} deal={d} {...rowProps}
                               open={openIds.has(d.id)} onToggle={() => onToggleRow(d.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- page ---------------------------------------------------------------

function DealerKoCarsPage() {
  useDealerNoIndex();

  const [booting, setBooting] = useStateDealer(true);
  const [session, setSession] = useStateDealer(null);
  const [statuses, setStatuses] = useStateDealer([]);
  const [salespeople, setSalespeople] = useStateDealer([]);
  const [brokers, setBrokers] = useStateDealer([]);
  const [deals, setDeals] = useStateDealer([]);
  const [fetchedAt, setFetchedAt] = useStateDealer(null);
  const [loadError, setLoadError] = useStateDealer('');
  const [query, setQuery] = useStateDealer('');
  const [statusFilter, setStatusFilter] = useStateDealer('all');
  const [sort, setSort] = useStateDealer('recent');
  const [view, setView] = useStateDealer('active'); // active | lost | archived
  const [collapsed, setCollapsed] = useStateDealer(() => new Set()); // collapsed stage groups
  const [openIds, setOpenIds] = useStateDealer(() => new Set()); // expanded rows
  const [formFor, setFormFor] = useStateDealer(null); // null | 'new' | deal
  const [invoiceFor, setInvoiceFor] = useStateDealer(null); // null | deal

  const showArchived = view === 'archived';

  const toggleGroup = useCallbackDealer((status) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  }, []);

  const toggleRow = useCallbackDealer((id) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Auto-refresh must not yank data out from under an open form.
  const formOpen = formFor !== null || invoiceFor !== null;
  const formOpenRef = useRefDealer(formOpen);
  formOpenRef.current = formOpen;

  const loadSession = useCallbackDealer(async () => {
    const { res, json } = await dealerFetch('/api/ko/session');
    if (res.ok && json && json.ok) {
      setStatuses(json.statuses || []);
      setSalespeople(json.salespeople || []);
      setBrokers(json.brokers || []);
      setSession(json.authenticated ? json.session : null);
      return json.authenticated;
    }
    setSession(null);
    return false;
  }, []);

  const loadDeals = useCallbackDealer(async (archived) => {
    const { res, json } = await dealerFetch(`/api/ko/deals?archived=${archived ? 'true' : 'false'}`);
    if (res.status === 401) { setSession(null); return; }
    if (res.ok && json && json.ok) {
      setDeals(json.deals || []);
      setFetchedAt(json.fetchedAt);
      setLoadError('');
    } else {
      setLoadError((json && json.error) || 'Could not load deals.');
    }
  }, []);

  useEffectDealer(() => {
    (async () => {
      const authed = await loadSession().catch(() => false);
      if (authed) await loadDeals(false).catch(() => {});
      setBooting(false);
    })();
  }, [loadSession, loadDeals]);

  // Refetch when the archived toggle flips.
  useEffectDealer(() => {
    if (session) loadDeals(showArchived).catch(() => {});
  }, [showArchived, session, loadDeals]);

  // Keeps KO Cars current without a manual refresh. Skipped while a form is
  // open, and while the tab is hidden.
  useEffectDealer(() => {
    if (!session) return undefined;
    const id = setInterval(() => {
      if (formOpenRef.current || document.hidden) return;
      loadDeals(showArchived).catch(() => {});
    }, DEALER_REFRESH_MS);
    return () => clearInterval(id);
  }, [session, showArchived, loadDeals]);

  const signOut = async () => {
    await dealerFetch('/api/ko/logout', { method: 'POST' }).catch(() => {});
    setSession(null);
    setDeals([]);
  };

  // Which of the loaded deals belong on the tab being looked at. The archived
  // tab has its own fetch, so everything loaded there is already in scope.
  const inView = useMemoDealer(() => {
    if (showArchived) return deals;
    return deals.filter((d) => (view === 'lost' ? dealerIsLost(d) : !dealerIsLost(d)));
  }, [deals, view, showArchived]);

  // Tab counts. Only meaningful for the two tabs served by the active fetch —
  // the archived count isn't known until that tab is opened.
  const counts = useMemoDealer(() => {
    if (showArchived) return null;
    let lost = 0;
    for (const d of deals) if (dealerIsLost(d)) lost += 1;
    return { active: deals.length - lost, lost };
  }, [deals, showArchived]);

  const visible = useMemoDealer(() => {
    const q = query.trim().toLowerCase();
    let list = inView;

    if (q) {
      list = list.filter((d) => [
        d.vehicle_make, d.vehicle_model, d.vehicle_variant, d.vehicle_registration,
        d.vehicle_stock_number, d.customer_name, d.customer_mobile, d.customer_email,
      ].some((v) => String(v || '').toLowerCase().includes(q)));
    }
    if (statusFilter !== 'all') list = list.filter((d) => d.status === statusFilter);

    const by = {
      recent: (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
      oldest: (a, b) => new Date(a.updated_at) - new Date(b.updated_at),
      vehicle: (a, b) => dealerVehicleTitle(a).localeCompare(dealerVehicleTitle(b)),
      customer: (a, b) => String(a.customer_name).localeCompare(String(b.customer_name)),
    };
    return [...list].sort(by[sort] || by.recent);
  }, [inView, query, statusFilter, sort]);

  // Board groups, in pipeline order. Empty stages are dropped so the board is
  // only as long as the work actually in it.
  const groups = useMemoDealer(() => {
    const bucket = new Map();
    for (const d of visible) {
      if (!bucket.has(d.status)) bucket.set(d.status, []);
      bucket.get(d.status).push(d);
    }
    const order = statuses.length ? statuses : Array.from(bucket.keys());
    const known = order.filter((s) => bucket.has(s));
    // Anything with a stage the server didn't list still has to appear.
    const extra = Array.from(bucket.keys()).filter((s) => !order.includes(s));
    return [...known, ...extra].map((status) => ({ status, deals: bucket.get(status) }));
  }, [visible, statuses]);

  if (booting) {
    return <main className="deal-shell"><p className="deal-booting">Loading…</p></main>;
  }

  if (!session) {
    return (
      <main className="deal-shell" data-screen-label="Dealer — KO Cars">
        <DealerLoginGate onSignedIn={async () => {
          setBooting(true);
          const authed = await loadSession().catch(() => false);
          if (authed) await loadDeals(false).catch(() => {});
          setBooting(false);
        }} />
      </main>
    );
  }

  const canEdit = typeof session.canEdit === 'boolean' ? session.canEdit : session.role === 'staff';
  const refresh = () => loadDeals(showArchived).catch(() => {});

  return (
    <main className="deal-page" data-screen-label="Dealer — KO Cars">
      <header className="deal-header">
        <div className="deal-header-top">
          <div>
            <BrandLogo light={false} size="sm" />
            <h1 className="deal-title">KO Cars Deal Tracker</h1>
          </div>
          <div className="deal-header-right">
            <p className="deal-signed-in">
              {session.name}
              <span className="deal-role">
                {session.role === 'staff' ? 'Staff' : (canEdit ? 'KO Cars' : 'KO Cars, view only')}
              </span>
            </p>
            <button type="button" className="btn ghost deal-btn-sm" onClick={signOut}>Sign out</button>
          </div>
        </div>

        {/* Tabs, not a filter: a declined deal leaves the live board entirely
            and is read on its own tab, so the active board only ever shows
            work that is still moving. */}
        <div className="board-tabs" role="tablist" aria-label="Deal board views">
          {DEALER_VIEWS.map((v) => {
            const count = counts && v.id !== 'archived' ? counts[v.id] : null;
            return (
              <button key={v.id} type="button" role="tab" aria-selected={view === v.id}
                      className={`board-tab${view === v.id ? ' is-active' : ''}`}
                      onClick={() => setView(v.id)}>
                {v.label}
                {count !== null && <span className="board-tab-count">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Search, stage filter and sort were removed 23 Oct 2026 at Josh's
            request (the board is short enough to scan). The filter state
            above stays at its defaults so the grouping code is unchanged. */}
        <div className="deal-subbar">
          <p className="deal-freshness">
            {fetchedAt ? `Last updated ${dealerClock(fetchedAt)} · refreshes automatically` : ''}
            {' '}
            <button type="button" className="btn link deal-refresh-now" onClick={refresh}>Refresh now</button>
          </p>
          <div className="deal-subbar-right">
            <p className="deal-count">
              {visible.length} {visible.length === 1 ? 'deal' : 'deals'}
              {visible.length !== inView.length ? ` of ${inView.length}` : ''}
            </p>
            {canEdit && (
              <button type="button" className="btn primary deal-add-btn deal-add-compact" onClick={() => setFormFor('new')}>
                Add deal
              </button>
            )}
          </div>
        </div>
      </header>

      {loadError && <p role="alert" className="deal-error deal-error-block">{loadError}</p>}

      {visible.length === 0 ? (
        <p className="deal-empty">
          {inView.length === 0
            ? (view === 'archived'
                ? 'No archived deals.'
                : view === 'lost'
                  ? 'Nothing declined or lost. Good.'
                  : 'No active deals yet.')
            : 'No deals match your search.'}
        </p>
      ) : (
        <div className="board">
          {groups.map((g) => (
            <DealerBoardGroup key={g.status} status={g.status} deals={g.deals}
                              collapsed={collapsed.has(g.status)} onToggleGroup={toggleGroup}
                              openIds={openIds} onToggleRow={toggleRow}
                              canEdit={canEdit} statuses={statuses} brokers={brokers}
                              onChanged={refresh} onEdit={(deal) => setFormFor(deal)}
                              onInvoice={(deal) => setInvoiceFor(deal)} />
          ))}
        </div>
      )}

      <DealerPrivacyNotice />

      {invoiceFor && canEdit && (
        <DealerInvoiceRequest
          deal={invoiceFor}
          onClose={() => setInvoiceFor(null)}
          onSent={() => { setInvoiceFor(null); refresh(); }}
        />
      )}

      {formFor !== null && canEdit && (
        <DealerDealForm
          deal={formFor === 'new' ? null : formFor}
          statuses={statuses}
          salespeople={salespeople}
          brokers={brokers}
          onClose={() => setFormFor(null)}
          onSaved={() => { setFormFor(null); refresh(); }}
        />
      )}
    </main>
  );
}

Object.assign(window, { DealerKoCarsPage });
