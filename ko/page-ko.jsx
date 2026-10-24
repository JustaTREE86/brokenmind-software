/* global React, isValidAUPhone, isValidEmail */
// =============================================================
// KO Cars full finance application — /ko-apply
//
// Replaces the AFOS quick-quote iframe that used to sit here. That widget
// collected a name and a number; Josh then built the whole application over
// the phone, chased documents one call at a time, and had no record of which
// car the customer was actually enquiring on.
//
// This page collects the lot in one sitting, in the same section order as the
// AFOS application PDF so Josh keys it straight in with no gaps. Documents are
// NOT uploaded here — the confirmation screen hands the customer a prefilled
// mailto so they attach them from their own phone. Nothing is stored on this
// site: no database, no storage bucket, no CRM. The submission is an email to
// nobody (emails are off) and nothing else.
//
// Deliberately NOT wired to /api/lead: that path runs through Make into
// GoHighLevel, and Josh wants this form kept out of that pipeline entirely.
// It posts to /api/ko-application, which only sends mail.
//
// Still hidden: no nav link, no footer link, no sitemap entry, noindex via
// robots.txt + vercel.json X-Robots-Tag + the meta swap below.
// =============================================================
const {
  useState: useStateKo,
  useEffect: useEffectKo,
  useMemo: useMemoKo,
} = React;

const KO_ENDPOINT = '/api/ko/application';
const KO_DOCS_EMAIL = ''; // no inbox wired up yet, call only
// Josh's direct mobile, not the BAG switchboard: a KO Cars customer stuck
// halfway through this form should reach Josh, not a general line.
const KO_PHONE = '0480 852 530';

// What the customer emails through after submitting. Kept here rather than in
// components.jsx because it is this dealership's list, not a site-wide one.
const KO_DOCS = [
  'Driver licence — front and back',
  'Your two most recent payslips',
  'Three months of bank statements',
  'Medicare card',
  'Proof of address — a recent utility bill or rates notice',
];

// Long mailto bodies get silently truncated (or refused) by some mail clients,
// so the fallback link caps its body and tells the customer what was cut. The
// reference and the contact details always survive the cap because they sit at
// the top of the body.
const KO_MAILTO_MAX = 1800;

// ---- option lists -------------------------------------------------------
const KO_OPTS = {
  yesno: ['Yes', 'No'],
  title: ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr'],
  gender: ['Male', 'Female', 'Prefer not to say'],
  residency: ['Australian Citizen', 'Permanent Resident', 'NZ Citizen', 'Visa Holder'],
  marital: ['Single', 'Married', 'De Facto', 'Separated', 'Divorced', 'Widowed'],
  state: ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'],
  frequency: ['Weekly', 'Fortnightly', 'Monthly'],
  appType: ['Personal', 'Commercial'],
  applicants: ['1', '2'],
  term: ['1', '2', '3', '4', '5', '6', '7'],
  empType: [
    'Full Time', 'Part Time', 'Casual', 'Contract', 'Self-Employed',
    'Centrelink', 'Retired', 'Unemployed',
  ],
  residentialStatus: ['Renting', 'Mortgage', 'Own Outright', 'Parents/Relative', 'Boarding', 'Employer Supplied'],
  otherIncome: ['Centrelink', 'Family Tax Benefit', 'Child Support', 'Rental Income', 'Investment Income', 'Pension', 'Other'],
  loanType: ['Car Loan', 'Personal Loan', 'Home Loan', 'Buy Now Pay Later', 'Overdraft', 'Other'],
};

// Every field the form collects, seeded empty. One flat object keeps `set()`
// trivial and makes the payload easy to read in the email.
const KO_BLANK = {
  // 1. the car
  vYear: '', vMake: '', vModel: '', vVariant: '', vStock: '', vPrice: '', vAck: false,
  // 2. finance
  finAmount: '', finTerm: '', finRepayment: '', finFrequency: '', appType: 'Personal', applicants: '1',
  // 3. applicant 1
  a1Title: '', a1First: '', a1Middle: '', a1Last: '', a1Dob: '', a1Gender: '',
  a1Residency: '', a1Citizenship: '', a1Licence: '', a1LicenceExpiry: '',
  a1LicenceState: '', a1LicenceCard: '', a1Marital: '', a1Dependants: '',
  a1DependantAges: '', a1Mobile: '', a1Email: '',
  // 4. applicant 2
  a2Title: '', a2First: '', a2Middle: '', a2Last: '', a2Dob: '', a2Gender: '',
  a2Residency: '', a2Citizenship: '', a2Licence: '', a2LicenceExpiry: '',
  a2LicenceState: '', a2LicenceCard: '', a2Marital: '', a2Mobile: '', a2Email: '',
  a2SameAddress: 'Yes', a2Address: '',
  // 5. business (self-employed only)
  bizName: '', bizAbn: '',
  // 6. address
  addrStreet: '', addrMovedIn: '', addrStatus: '', addrLandlord: '',
  prevAddrStreet: '', prevAddrMovedIn: '', prevAddrStatus: '',
  // 7. employment & income
  empType: '', empEmployer: '', empAddress: '', empPhone: '', empOccupation: '',
  empStart: '', empIncome: '', empIncomeFreq: '',
  prevEmployer: '', prevOccupation: '', prevEmpType: '', prevEmpDuration: '',
  job2Employer: '', job2Occupation: '', job2Income: '', job2Freq: '',
  otherIncomeType: '', otherIncomeAmount: '', otherIncomeFreq: '',
  // 8. expenses (monthly)
  expLiving: '', expChildcare: '', expPhone: '', expInsurance: '', expTransport: '',
  expOther: '', expOtherType: '',
  // 9. assets & liabilities
  ownProperty: '', propertyValue: '', propertyOwing: '',
  ownVehicle: '', vehicleValue: '', vehicleOwing: '',
  savingsBank: '', savingsValue: '', superValue: '', otherAssets: '',
  hasLoans: '', loanType: '', loanLender: '', loanOwing: '', loanRepayment: '',
  loanFreq: '', loanPayout: '',
  hasCards: '', cardIssuer: '', cardLimit: '', cardOwing: '',
  // 10. declarations
  decDefaults: '', decBankrupt: '', decAdverse: '', decChange: '',
  decDetails: '', decAnythingElse: '',
  ref1Name: '', ref1Rel: '', ref1Phone: '', ref1Address: '',
  ref2Name: '', ref2Rel: '', ref2Phone: '', ref2Address: '',
  consent: false,
  // honeypot — the name is deliberately meaningless. A field called "company"
  // gets filled by Chrome's address autofill, which would silently bin a real
  // application. Same reasoning as the apply and credit repair forms.
  koXr7: '',
};

// Swaps the sitewide <meta name="robots"> to noindex while this page is
// mounted, and restores it on unmount. Deliberately local rather than shared
// with page-autozone.jsx / page-dealer.jsx — see the note in page-dealer.jsx.
function useKoNoIndex() {
  useEffectKo(() => {
    const meta = document.querySelector('meta[name="robots"]');
    const prev = meta ? meta.getAttribute('content') : null;
    if (meta) meta.setAttribute('content', 'noindex, nofollow');
    return () => { if (meta && prev != null) meta.setAttribute('content', prev); };
  }, []);
}

// True when `iso` (a yyyy-mm-dd from a date input) is less than `years` ago.
// Blank or unparseable dates return false: an empty date must not spring open
// a conditional section the customer never asked for.
function koWithinYears(iso, years) {
  if (!iso) return false;
  const then = new Date(iso);
  if (isNaN(then.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return then > cutoff;
}

// Turns the ordered section structure into the plain-text body used by both
// the email (server side rebuilds its own copy) and the mailto fallback.
function koSectionsToText(sections) {
  return sections.map(s => {
    const rows = s.rows.map(([label, value]) => `  ${label}: ${value}`).join('\n');
    return `${s.title.toUpperCase()}\n${rows}`;
  }).join('\n\n');
}

function KoApplyPage() {
  useKoNoIndex();

  const [f, setF] = useStateKo(KO_BLANK);
  const [sent, setSent] = useStateKo(false);
  const [error, setError] = useStateKo('');
  const [sending, setSending] = useStateKo(false);
  // Set only when delivery failed, so the customer can still get their
  // application to Josh rather than losing twenty minutes of typing.
  const [fallbackMailto, setFallbackMailto] = useStateKo('');
  const [reference] = useStateKo(() => 'KO-' + Math.floor(Math.random() * 9000 + 1000));

  const set = k => e => setF(s => ({
    ...s,
    [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }));

  // ---- conditional sections ---------------------------------------------
  const twoApplicants = f.applicants === '2';
  const selfEmployed = f.empType === 'Self-Employed';
  const needsPrevAddress = koWithinYears(f.addrMovedIn, 3);
  const needsPrevEmployer = koWithinYears(f.empStart, 1);

  // ---- field factories ---------------------------------------------------
  // Not components — plain element factories called during render, so typing
  // in one field never remounts (and blurs) the input.
  const text = (k, label, opts = {}) => (
    <div className="bp-field">
      <label htmlFor={`ko-${k}`}>{label}{opts.req && <span aria-hidden="true"> *</span>}</label>
      <input
        id={`ko-${k}`}
        type={opts.type || 'text'}
        inputMode={opts.inputMode}
        autoComplete={opts.autoComplete || 'off'}
        placeholder={opts.placeholder}
        value={f[k]}
        onChange={set(k)}
      />
    </div>
  );

  const select = (k, label, options, opts = {}) => (
    <div className="bp-field">
      <label htmlFor={`ko-${k}`}>{label}{opts.req && <span aria-hidden="true"> *</span>}</label>
      <select id={`ko-${k}`} className="cr-select" value={f[k]} onChange={set(k)}>
        <option value="">Select…</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  const area = (k, label, rows = 3, placeholder = '') => (
    <div className="bp-field">
      <label htmlFor={`ko-${k}`}>{label}</label>
      <textarea id={`ko-${k}`} rows={rows} value={f[k]} onChange={set(k)} placeholder={placeholder} />
    </div>
  );

  const row = (...kids) => <div className="bp-row">{kids}</div>;
  const money = (k, label, opts = {}) => text(k, label, { inputMode: 'decimal', placeholder: '$', ...opts });
  const heading = (n, title, note) => (
    <div style={{ marginTop: 8 }}>
      <div className="eyebrow" style={{ color: 'var(--gold-2)' }}><span className="dot"></span>Section {n}</div>
      <h2 className="apply-panel-title" style={{ marginBottom: note ? 6 : 14 }}>{title}</h2>
      {note && <p className="apply-panel-lede" style={{ marginBottom: 14 }}>{note}</p>}
    </div>
  );

  // ---- the email body ----------------------------------------------------
  // Built here, in AFOS section order, because this file already holds the
  // labels. The server re-validates the critical fields itself and treats
  // these rows as untrusted display text.
  const sections = useMemoKo(() => {
    const only = rows => rows.filter(([, v]) => String(v || '').trim() !== '');
    const out = [];
    const push = (title, rows) => { const r = only(rows); if (r.length) out.push({ title, rows: r }); };

    push('1. Vehicle', [
      ['Vehicle', [f.vYear, f.vMake, f.vModel, f.vVariant].filter(Boolean).join(' ')],
      ['Stock number / rego', f.vStock],
      ['Purchase price', f.vPrice],
      ['Vehicle confirmed by applicant', f.vAck ? 'Yes' : 'No'],
    ]);
    push('2. Finance requested', [
      ['Application type', f.appType],
      ['Number of applicants', f.applicants],
      ['Finance amount', f.finAmount],
      ['Term (years)', f.finTerm],
      ['Preferred repayment', f.finRepayment],
      ['Repayment frequency', f.finFrequency],
    ]);
    push('3. Applicant 1', [
      ['Title', f.a1Title], ['First name', f.a1First], ['Middle name', f.a1Middle],
      ['Last name', f.a1Last], ['Date of birth', f.a1Dob], ['Gender', f.a1Gender],
      ['Residency status', f.a1Residency], ['Citizenship', f.a1Citizenship],
      ['Licence number', f.a1Licence], ['Licence expiry', f.a1LicenceExpiry],
      ['Licence state', f.a1LicenceState], ['Licence card number', f.a1LicenceCard],
      ['Marital status', f.a1Marital], ['Dependants', f.a1Dependants],
      ['Ages of dependants', f.a1DependantAges], ['Mobile', f.a1Mobile], ['Email', f.a1Email],
    ]);
    if (twoApplicants) {
      push('4. Applicant 2', [
        ['Title', f.a2Title], ['First name', f.a2First], ['Middle name', f.a2Middle],
        ['Last name', f.a2Last], ['Date of birth', f.a2Dob], ['Gender', f.a2Gender],
        ['Residency status', f.a2Residency], ['Citizenship', f.a2Citizenship],
        ['Licence number', f.a2Licence], ['Licence expiry', f.a2LicenceExpiry],
        ['Licence state', f.a2LicenceState], ['Licence card number', f.a2LicenceCard],
        ['Marital status', f.a2Marital], ['Mobile', f.a2Mobile], ['Email', f.a2Email],
        ['Lives at same address', f.a2SameAddress],
        ['Applicant 2 address', f.a2SameAddress === 'No' ? f.a2Address : ''],
      ]);
    }
    if (selfEmployed) {
      push('5. Business', [['Entity name', f.bizName], ['ABN', f.bizAbn]]);
    }
    push('6. Address', [
      ['Current address', f.addrStreet], ['Date moved in', f.addrMovedIn],
      ['Residential status', f.addrStatus], ['Landlord / mortgage / relative', f.addrLandlord],
      ['Previous address', needsPrevAddress ? f.prevAddrStreet : ''],
      ['Previous — date moved in', needsPrevAddress ? f.prevAddrMovedIn : ''],
      ['Previous — status', needsPrevAddress ? f.prevAddrStatus : ''],
    ]);
    push('7. Employment & income', [
      ['Employment type', f.empType], ['Employer', f.empEmployer],
      ['Work address', f.empAddress], ['Employer phone', f.empPhone],
      ['Occupation', f.empOccupation], ['Start date', f.empStart],
      ['Income after tax', f.empIncome], ['Income frequency', f.empIncomeFreq],
      ['Previous employer', needsPrevEmployer ? f.prevEmployer : ''],
      ['Previous occupation', needsPrevEmployer ? f.prevOccupation : ''],
      ['Previous employment type', needsPrevEmployer ? f.prevEmpType : ''],
      ['Time in previous role', needsPrevEmployer ? f.prevEmpDuration : ''],
      ['Second job — employer', f.job2Employer],
      ['Second job — occupation', f.job2Occupation],
      ['Second job — income', f.job2Income],
      ['Second job — frequency', f.job2Freq],
      ['Other income type', f.otherIncomeType],
      ['Other income amount', f.otherIncomeAmount],
      ['Other income frequency', f.otherIncomeFreq],
    ]);
    push('8. Living expenses (monthly)', [
      ['Basic living', f.expLiving], ['Childcare / maintenance', f.expChildcare],
      ['Phone, internet, pay TV', f.expPhone], ['Insurance', f.expInsurance],
      ['Fuel / travel / transport', f.expTransport],
      ['Other expenses', f.expOther], ['Other expense type', f.expOtherType],
    ]);
    push('9. Assets & liabilities', [
      ['Owns property', f.ownProperty],
      ['Property value', f.ownProperty === 'Yes' ? f.propertyValue : ''],
      ['Property owing', f.ownProperty === 'Yes' ? f.propertyOwing : ''],
      ['Owns a motor vehicle', f.ownVehicle],
      ['Vehicle value', f.ownVehicle === 'Yes' ? f.vehicleValue : ''],
      ['Vehicle owing', f.ownVehicle === 'Yes' ? f.vehicleOwing : ''],
      ['Bank', f.savingsBank], ['Savings', f.savingsValue],
      ['Superannuation', f.superValue], ['Other assets', f.otherAssets],
      ['Has loans outstanding', f.hasLoans],
      ['Loan type', f.hasLoans === 'Yes' ? f.loanType : ''],
      ['Lender', f.hasLoans === 'Yes' ? f.loanLender : ''],
      ['Amount owing', f.hasLoans === 'Yes' ? f.loanOwing : ''],
      ['Repayment', f.hasLoans === 'Yes' ? f.loanRepayment : ''],
      ['Repayment frequency', f.hasLoans === 'Yes' ? f.loanFreq : ''],
      ['Paying out at settlement', f.hasLoans === 'Yes' ? f.loanPayout : ''],
      ['Has credit cards', f.hasCards],
      ['Card issuer', f.hasCards === 'Yes' ? f.cardIssuer : ''],
      ['Credit limit', f.hasCards === 'Yes' ? f.cardLimit : ''],
      ['Amount owing on cards', f.hasCards === 'Yes' ? f.cardOwing : ''],
    ]);
    push('10. Declarations & references', [
      ['Past or current debts in default', f.decDefaults],
      ['Bankrupt or insolvent', f.decBankrupt],
      ['Anything that may adversely affect this application', f.decAdverse],
      ['Expects an adverse change to financial position', f.decChange],
      ['Declaration details', f.decDetails],
      ['Anything else to tell us', f.decAnythingElse],
      ['Reference 1', [f.ref1Name, f.ref1Rel, f.ref1Phone, f.ref1Address].filter(Boolean).join(' · ')],
      ['Reference 2', [f.ref2Name, f.ref2Rel, f.ref2Phone, f.ref2Address].filter(Boolean).join(' · ')],
      ['Privacy consent given', f.consent ? 'Yes' : 'No'],
    ]);
    return out;
  }, [f, twoApplicants, selfEmployed, needsPrevAddress, needsPrevEmployer]);

  const applicantName = [f.a1First, f.a1Last].filter(Boolean).join(' ').trim();

  // ---- submit ------------------------------------------------------------
  const submit = async e => {
    e.preventDefault();
    if (sending) return;

    // Required set kept deliberately short: everything a lender needs is asked
    // for, but only what Josh cannot proceed without actually blocks submit.
    if (!f.vMake.trim() || !f.vModel.trim()) { setError('Please tell us the make and model of the car you’re applying for.'); return; }
    if (!f.vAck) { setError('Please confirm the vehicle you’re applying to finance.'); return; }
    if (!f.a1First.trim() || !f.a1Last.trim()) { setError('Please enter your first and last name.'); return; }
    if (!f.a1Dob) { setError('Please enter your date of birth.'); return; }
    if (!isValidAUPhone(f.a1Mobile)) { setError('Please enter a valid Australian mobile number.'); return; }
    if (!isValidEmail(f.a1Email)) { setError('Please enter a valid email address.'); return; }
    if (!f.addrStreet.trim()) { setError('Please enter your current residential address.'); return; }
    if (!f.empType) { setError('Please select your employment type.'); return; }
    if (!f.consent) { setError('Please accept the privacy consent so we can assess your application.'); return; }

    // Honeypot — a bot that fills every field gets a plausible success and
    // nothing is sent.
    if (f.koXr7) { setSent(true); return; }

    setError('');
    setFallbackMailto('');
    setSending(true);

    let delivered = false;
    try {
      const res = await fetch(KO_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          reference,
          dealer: 'KO Cars',
          name: applicantName,
          email: f.a1Email,
          phone: f.a1Mobile,
          vehicle: [f.vYear, f.vMake, f.vModel, f.vVariant].filter(Boolean).join(' '),
          vehicleAcknowledged: f.vAck ? 'Yes' : 'No',
          consentToPrivacyPolicy: f.consent ? 'Yes' : 'No',
          sections,
          sourceUrl: window.location.href,
          hp: f.koXr7,
        }),
      });
      const json = await res.json().catch(() => ({}));
      delivered = res.ok && json.ok === true;
    } catch (err) {
      delivered = false;
    }
    setSending(false);

    // Never confirm an application that did not actually leave the browser.
    // /api/lead's header comment records what silent success cost last time.
    if (!delivered) {
      const head =
        `Reference: ${reference}\n` +
        `Name: ${applicantName || '—'}\n` +
        `Mobile: ${f.a1Mobile || '—'}\n` +
        `Email: ${f.a1Email || '—'}\n` +
        `Vehicle: ${[f.vYear, f.vMake, f.vModel, f.vVariant].filter(Boolean).join(' ') || '—'}\n\n`;
      let body = head + koSectionsToText(sections);
      if (body.length > KO_MAILTO_MAX) {
        body = body.slice(0, KO_MAILTO_MAX) + '\n\n[Cut short by your email app — please call and we’ll take the rest over the phone.]';
      }
      setFallbackMailto(
        `mailto:${KO_DOCS_EMAIL}?subject=${encodeURIComponent(`KO Cars Application ${reference} — ${applicantName}`)}` +
        `&body=${encodeURIComponent(body)}`
      );
      setError(
        `We couldn’t send your application just then. Nothing you typed has been lost, but we don’t have it yet. ` +
        `Please call Josh on ${KO_PHONE} quoting reference ${reference} and he’ll finish it with you.`
      );
      return;
    }
    setSent(true);
  };

  // ---- confirmation ------------------------------------------------------
  if (sent) {
    const docsMailto =
      `mailto:${KO_DOCS_EMAIL}?subject=${encodeURIComponent(`Documents for ${reference}${applicantName ? ' — ' + applicantName : ''}`)}` +
      `&body=${encodeURIComponent(
        `Hi Josh,\n\nMy documents are attached for my KO Cars finance application.\n\nReference: ${reference}\n\nThanks.${applicantName ? '\n' + applicantName : ''}`
      )}`;

    return (
      <main data-screen-label="KO Cars — Application received">
        <section className="section paper" style={{ minHeight: '70vh' }}>
          <div className="container cr-narrow apply-done" style={{ paddingTop: 24 }}>
            <div className="eyebrow"><span className="dot"></span>Application received</div>
            <h1 className="h1" style={{ marginTop: 16, marginBottom: 20 }}>
              Thanks{applicantName ? ', ' : ''}
              <em style={{ fontStyle: 'italic', color: 'var(--gold-2)' }}>{f.a1First}</em>.
            </h1>
            <p className="lede" style={{ maxWidth: '48ch', marginBottom: 28 }}>
              Your application is with Josh. He’ll be in touch within one business day. There is one more thing to do below, and doing it now is what gets you approved faster.
            </p>

            <div className="apply-ref-callout" style={{ marginBottom: 32 }}>
              <span className="eyebrow" style={{ margin: 0 }}>Your reference</span>
              <strong className="tabular">{reference}</strong>
              <span className="apply-ref-hint">Put this in your email subject line</span>
            </div>

            <section className="apply-panel" aria-labelledby="kodocs-h">
              <div className="eyebrow" style={{ color: 'var(--gold-2)' }}><span className="dot"></span>Last step</div>
              <h2 id="kodocs-h" className="apply-panel-title">Email us your documents</h2>
              <p className="apply-panel-lede">
                Send these to <a href={`mailto:${KO_DOCS_EMAIL}`} style={{ color: 'var(--gold-2)', textDecoration: 'underline' }}>{KO_DOCS_EMAIL}</a> with <strong>{reference}</strong> in the subject line. Photos from your phone are fine.
              </p>
              <ul className="apply-checklist">
                {KO_DOCS.map(d => <li key={d}>{d}</li>)}
              </ul>
              <a className="btn primary" href={docsMailto}>
                Email my documents <span className="arrow">→</span>
              </a>
            </section>

            <p className="apply-panel-note">
              Questions before then? Call {KO_PHONE} and quote {reference}.
            </p>
          </div>
        </section>
      </main>
    );
  }

  // ---- the form ----------------------------------------------------------
  return (
    <main data-screen-label="KO Cars — Finance Application">
      <section className="section paper">
        <div className="container cr-narrow">
          {/* KO Cars branding only. No BAG logo, no BAG lockup — Josh's call:
              this reads as KO Cars' own form to KO Cars' own customer. The
              licensee is still named in the consent small print at the bottom,
              because the entity collecting credit information has to be. */}
          <header style={{ marginBottom: 28 }}>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 26, fontWeight: 700, letterSpacing: '0.22em', color: 'var(--ink)', lineHeight: 1 }}>
              KO CARS
            </div>
            <div style={{ width: 44, height: 2, background: 'var(--gold)', margin: '12px 0 14px' }}></div>
            <h1 className="h3" style={{ margin: 0 }}>Finance application</h1>
            <p className="body" style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 14 }}>
              With Josh, Senior Finance Broker
            </p>
          </header>

          <p className="lede" style={{ maxWidth: '52ch', marginBottom: 8 }}>
            Fill this in once and Josh can go straight to the lenders. It takes about 10 minutes. Have your licence and a recent payslip handy.
          </p>
          <p className="apply-panel-note" style={{ marginBottom: 28 }}>
            Fields marked * are required. Everything else helps, so fill in what you can. Documents are emailed through after you submit, so nothing is uploaded here.
          </p>

          <form className="bp-form" onSubmit={submit} noValidate>

            {/* ---- 1. the car ---- */}
            {heading(1, 'The car you’re applying for', 'Take these details off the windscreen card or ask your salesperson.')}
            {row(
              text('vYear', 'Year', { inputMode: 'numeric', placeholder: '2019' }),
              text('vMake', 'Make', { req: true, placeholder: 'Ford' })
            )}
            {row(
              text('vModel', 'Model', { req: true, placeholder: 'Ranger' }),
              text('vVariant', 'Variant / badge', { placeholder: 'XLT 4x4' })
            )}
            {row(
              text('vStock', 'Stock number or rego', { placeholder: 'KO1234 / 123ABC' }),
              money('vPrice', 'Purchase price')
            )}
            <label className="apply-consent">
              <input type="checkbox" checked={f.vAck} onChange={set('vAck')} />
              <span>
                <strong>I confirm this is the vehicle I am applying to finance.</strong> If the car changes, I will tell KO Cars and Josh before settlement.
              </span>
            </label>

            <div className="cr-divider" role="separator"></div>

            {/* ---- 2. finance ---- */}
            {heading(2, 'The finance you want')}
            {row(
              select('appType', 'Application type', KO_OPTS.appType),
              select('applicants', 'How many applicants?', KO_OPTS.applicants)
            )}
            {row(
              money('finAmount', 'Amount you want to borrow'),
              select('finTerm', 'Term (years)', KO_OPTS.term)
            )}
            {row(
              money('finRepayment', 'Preferred repayment'),
              select('finFrequency', 'Repayment frequency', KO_OPTS.frequency)
            )}

            <div className="cr-divider" role="separator"></div>

            {/* ---- 3. applicant 1 ---- */}
            {heading(3, 'About you')}
            {row(
              select('a1Title', 'Title', KO_OPTS.title),
              text('a1First', 'First name', { req: true, autoComplete: 'given-name' })
            )}
            {row(
              text('a1Middle', 'Middle name'),
              text('a1Last', 'Last name', { req: true, autoComplete: 'family-name' })
            )}
            {row(
              text('a1Dob', 'Date of birth', { req: true, type: 'date' }),
              select('a1Gender', 'Gender', KO_OPTS.gender)
            )}
            {row(
              select('a1Residency', 'Residency status', KO_OPTS.residency),
              text('a1Citizenship', 'Country of citizenship', { placeholder: 'Australia' })
            )}
            {row(
              text('a1Licence', 'Driver licence number'),
              text('a1LicenceExpiry', 'Licence expiry', { type: 'date' })
            )}
            {row(
              select('a1LicenceState', 'State of issue', KO_OPTS.state),
              text('a1LicenceCard', 'Licence card number', { placeholder: 'On the front or back of the card' })
            )}
            {row(
              select('a1Marital', 'Marital status', KO_OPTS.marital),
              text('a1Dependants', 'Number of dependants', { inputMode: 'numeric' })
            )}
            {row(
              text('a1DependantAges', 'Ages of dependants', { placeholder: 'e.g. 6, 9' }),
              text('a1Mobile', 'Mobile', { req: true, type: 'tel', autoComplete: 'tel', placeholder: '04XX XXX XXX' })
            )}
            {text('a1Email', 'Email', { req: true, type: 'email', autoComplete: 'email', placeholder: 'you@email.com' })}

            {/* ---- 4. applicant 2 ---- */}
            {twoApplicants && (
              <>
                <div className="cr-divider" role="separator"></div>
                {heading(4, 'About your co-applicant')}
                {row(
                  select('a2Title', 'Title', KO_OPTS.title),
                  text('a2First', 'First name')
                )}
                {row(
                  text('a2Middle', 'Middle name'),
                  text('a2Last', 'Last name')
                )}
                {row(
                  text('a2Dob', 'Date of birth', { type: 'date' }),
                  select('a2Gender', 'Gender', KO_OPTS.gender)
                )}
                {row(
                  select('a2Residency', 'Residency status', KO_OPTS.residency),
                  text('a2Citizenship', 'Country of citizenship')
                )}
                {row(
                  text('a2Licence', 'Driver licence number'),
                  text('a2LicenceExpiry', 'Licence expiry', { type: 'date' })
                )}
                {row(
                  select('a2LicenceState', 'State of issue', KO_OPTS.state),
                  text('a2LicenceCard', 'Licence card number')
                )}
                {row(
                  select('a2Marital', 'Marital status', KO_OPTS.marital),
                  text('a2Mobile', 'Mobile', { type: 'tel', placeholder: '04XX XXX XXX' })
                )}
                {row(
                  text('a2Email', 'Email', { type: 'email' }),
                  select('a2SameAddress', 'Lives at the same address?', KO_OPTS.yesno)
                )}
                {f.a2SameAddress === 'No' && text('a2Address', 'Co-applicant’s address')}
              </>
            )}

            {/* ---- 6. address ---- */}
            <div className="cr-divider" role="separator"></div>
            {heading(twoApplicants ? 5 : 4, 'Where you live')}
            {text('addrStreet', 'Current residential address', { req: true, autoComplete: 'street-address', placeholder: 'Unit / number, street, suburb, state, postcode' })}
            {row(
              text('addrMovedIn', 'Date you moved in', { type: 'date' }),
              select('addrStatus', 'Residential status', KO_OPTS.residentialStatus)
            )}
            {text('addrLandlord', 'Landlord, mortgage holder or relative’s name', { placeholder: 'Who you pay, or who you live with' })}
            {needsPrevAddress && (
              <>
                <p className="apply-panel-note">
                  You’ve been there under three years, so lenders need the address before it.
                </p>
                {text('prevAddrStreet', 'Previous address')}
                {row(
                  text('prevAddrMovedIn', 'Date you moved in there', { type: 'date' }),
                  select('prevAddrStatus', 'Status there', KO_OPTS.residentialStatus)
                )}
              </>
            )}

            {/* ---- 7. employment ---- */}
            <div className="cr-divider" role="separator"></div>
            {heading(twoApplicants ? 6 : 5, 'Work and income')}
            {row(
              select('empType', 'Employment type', KO_OPTS.empType, { req: true }),
              text('empEmployer', 'Employer name')
            )}
            {selfEmployed && (
              <>
                <p className="apply-panel-note">Self-employed, so we need the business details too.</p>
                {row(
                  text('bizName', 'Entity name'),
                  text('bizAbn', 'ABN', { inputMode: 'numeric' })
                )}
              </>
            )}
            {text('empAddress', 'Work address')}
            {row(
              text('empPhone', 'Employer phone', { type: 'tel' }),
              text('empOccupation', 'Your occupation')
            )}
            {row(
              text('empStart', 'Start date', { type: 'date' }),
              money('empIncome', 'Income after tax')
            )}
            {select('empIncomeFreq', 'How often are you paid?', KO_OPTS.frequency)}
            {needsPrevEmployer && (
              <>
                <p className="apply-panel-note">
                  Under twelve months in the role, so lenders need the job before it.
                </p>
                {row(
                  text('prevEmployer', 'Previous employer'),
                  text('prevOccupation', 'Previous occupation')
                )}
                {row(
                  select('prevEmpType', 'Previous employment type', KO_OPTS.empType),
                  text('prevEmpDuration', 'How long were you there?', { placeholder: 'e.g. 2 years 3 months' })
                )}
              </>
            )}
            {row(
              text('job2Employer', 'Second job — employer', { placeholder: 'Leave blank if none' }),
              text('job2Occupation', 'Second job — occupation')
            )}
            {row(
              money('job2Income', 'Second job — income after tax'),
              select('job2Freq', 'Second job — frequency', KO_OPTS.frequency)
            )}
            {row(
              select('otherIncomeType', 'Other income type', KO_OPTS.otherIncome),
              money('otherIncomeAmount', 'Other income amount')
            )}
            {select('otherIncomeFreq', 'Other income frequency', KO_OPTS.frequency)}

            {/* ---- 8. expenses ---- */}
            <div className="cr-divider" role="separator"></div>
            {heading(twoApplicants ? 7 : 6, 'Monthly living expenses', 'Rough monthly figures are fine. Lenders check these against your bank statements, so keep them realistic.')}
            {row(
              money('expLiving', 'Basic living (food, household)'),
              money('expChildcare', 'Childcare / child maintenance')
            )}
            {row(
              money('expPhone', 'Phone, internet, pay TV'),
              money('expInsurance', 'Insurance')
            )}
            {row(
              money('expTransport', 'Fuel, travel, transport'),
              money('expOther', 'Other expenses')
            )}
            {text('expOtherType', 'What are the other expenses?')}

            {/* ---- 9. assets & liabilities ---- */}
            <div className="cr-divider" role="separator"></div>
            {heading(twoApplicants ? 8 : 7, 'What you own and what you owe')}
            {select('ownProperty', 'Do you own property?', KO_OPTS.yesno)}
            {f.ownProperty === 'Yes' && row(
              money('propertyValue', 'Property value'),
              money('propertyOwing', 'Still owing on it')
            )}
            {select('ownVehicle', 'Do you own a motor vehicle?', KO_OPTS.yesno)}
            {f.ownVehicle === 'Yes' && row(
              money('vehicleValue', 'Vehicle value'),
              money('vehicleOwing', 'Still owing on it')
            )}
            {row(
              text('savingsBank', 'Who do you bank with?'),
              money('savingsValue', 'Savings')
            )}
            {row(
              money('superValue', 'Superannuation'),
              text('otherAssets', 'Other assets')
            )}
            {select('hasLoans', 'Any loans outstanding?', KO_OPTS.yesno)}
            {f.hasLoans === 'Yes' && (
              <>
                {row(
                  select('loanType', 'Loan type', KO_OPTS.loanType),
                  text('loanLender', 'Lender')
                )}
                {row(
                  money('loanOwing', 'Amount owing'),
                  money('loanRepayment', 'Repayment')
                )}
                {row(
                  select('loanFreq', 'Repayment frequency', KO_OPTS.frequency),
                  select('loanPayout', 'Paying it out at settlement?', KO_OPTS.yesno)
                )}
              </>
            )}
            {select('hasCards', 'Any credit cards?', KO_OPTS.yesno)}
            {f.hasCards === 'Yes' && (
              <>
                {row(
                  text('cardIssuer', 'Card issuer'),
                  money('cardLimit', 'Credit limit')
                )}
                {money('cardOwing', 'Amount owing')}
              </>
            )}

            {/* ---- 10. declarations ---- */}
            <div className="cr-divider" role="separator"></div>
            {heading(twoApplicants ? 9 : 8, 'Declarations', 'Answer these honestly. A “yes” is not automatically a problem, but a surprise at the lender is.')}
            {row(
              select('decDefaults', 'Any past or current debts in default?', KO_OPTS.yesno),
              select('decBankrupt', 'Ever bankrupt or insolvent?', KO_OPTS.yesno)
            )}
            {row(
              select('decAdverse', 'Anything that may affect this application?', KO_OPTS.yesno),
              select('decChange', 'Expecting your financial position to change?', KO_OPTS.yesno)
            )}
            {area('decDetails', 'If you answered yes to any of the above, tell us more', 3, 'What happened, and when')}
            {area('decAnythingElse', 'Anything else you want us to know?', 3)}

            <div className="cr-divider" role="separator"></div>

            {heading(twoApplicants ? 10 : 9, 'Personal references', 'Two people not living with you. Some lenders ask, some don’t.')}
            {row(
              text('ref1Name', 'Reference 1 — full name'),
              text('ref1Rel', 'Relationship to you')
            )}
            {row(
              text('ref1Phone', 'Phone', { type: 'tel' }),
              text('ref1Address', 'Suburb')
            )}
            {row(
              text('ref2Name', 'Reference 2 — full name'),
              text('ref2Rel', 'Relationship to you')
            )}
            {row(
              text('ref2Phone', 'Phone', { type: 'tel' }),
              text('ref2Address', 'Suburb')
            )}

            {/* Honeypot — the name must stay meaningless, see KO_BLANK. */}
            <input
              type="text" name="ko-xr7" value={f.koXr7} onChange={set('koXr7')}
              tabIndex={-1} autoComplete="off" aria-hidden="true"
              style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
            />

            <label className="apply-consent">
              <input type="checkbox" checked={f.consent} onChange={set('consent')} />
              <span>
                I declare the information above is true and complete. I consent to my finance broker collecting and using it to assess my finance application, contacting me about it, and disclosing it to lenders and credit reporting bodies for that purpose.
              </span>
            </label>

            {error && <p role="alert" style={{ color: '#b3261e', fontSize: 14, marginTop: 4 }}>{error}</p>}
            {fallbackMailto && KO_DOCS_EMAIL && (
              <p style={{ marginTop: 8 }}>
                <a className="btn primary" href={fallbackMailto}>
                  Email my application instead <span className="arrow">→</span>
                </a>
              </p>
            )}

            <p className="apply-panel-note" style={{ marginTop: 4 }}>
              Submitting this is not an application for credit with any lender and does not affect your credit score. Josh will review it and come back to you with options.
            </p>

            <button type="submit" className="btn primary" disabled={sending} style={{ marginTop: 8, opacity: sending ? 0.6 : 1 }}>
              {sending ? 'Sending…' : <>Submit my application <span className="arrow">→</span></>}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

Object.assign(window, { KoApplyPage });
