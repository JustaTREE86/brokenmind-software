// KO Cars finance application endpoint (/ko/apply). No email at all.
// Each submission is saved as a "New Referral" deal on the KO Cars board
// (public.deals) with an opening note carrying the reference. The full form
// (all sections, contains PII) is stored server-side in public.ko_applications
// (RLS on, no policies: service role only), linked to the deal.
const { isValidAUPhone, isValidEmail } = require('../util');
const { clean, MAX } = require('../deals');
const { getDealerBySlug, insertDeal, insertNote, sbRequest } = require('../supabase');

const AUTHOR = 'Online application';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  const b = req.body || {};
  const supplied = String(b.reference || '').slice(0, 20);
  const reference = /^KO-\d{4}$/.test(supplied) ? supplied : 'KO-' + String(Math.floor(Math.random() * 9000 + 1000));
  // Honeypot: pretend success, store nothing.
  if (String(b.hp || '').trim()) return res.status(200).json({ ok: true, reference });
  if (!String(b.name || '').trim()) return res.status(400).json({ ok: false, error: 'Please enter your name.' });
  if (!isValidAUPhone(b.phone)) return res.status(400).json({ ok: false, error: 'Please enter a valid Australian phone number.' });
  if (!isValidEmail(b.email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  if (b.consentToPrivacyPolicy !== 'Yes') return res.status(400).json({ ok: false, error: 'Please tick the privacy consent.' });

  try {
    const dealer = await getDealerBySlug('ko-cars');
    if (!dealer) throw new Error('KO Cars dealer row missing');
    const year = parseInt(String(b.vYear || ''), 10);
    const deal = await insertDeal({
      dealer_id: dealer.id,
      customer_name: clean(b.name, MAX.customer_name),
      customer_mobile: clean(b.phone, MAX.customer_mobile),
      customer_email: clean(b.email, MAX.customer_email),
      vehicle_year: year >= 1950 && year <= 2100 ? year : null,
      vehicle_make: clean(b.vMake, MAX.vehicle_make) || null,
      vehicle_model: clean(b.vModel, MAX.vehicle_model) || null,
      vehicle_variant: clean(b.vVariant, MAX.vehicle_variant) || null,
      vehicle_stock_number: clean(b.vStock, MAX.vehicle_stock_number) || null,
      status: 'New Referral',
      created_by: AUTHOR,
      updated_by: AUTHOR,
    });
    if (!deal) throw new Error('insert returned no row');
    let stored = false;
    try {
      const payload = {
        name: clean(b.name, 200), email: clean(b.email, 200), phone: clean(b.phone, 40),
        vehicle: clean(b.vehicle, 300), vehicleAcknowledged: b.vehicleAcknowledged === 'Yes',
        sections: b.sections && typeof b.sections === 'object' ? b.sections : null,
      };
      if (JSON.stringify(payload).length > 200000) throw new Error('payload too large');
      await sbRequest('ko_applications', {
        method: 'POST',
        prefer: 'return=minimal',
        body: { deal_id: deal.id, dealer_id: dealer.id, reference, payload,
          consent_privacy: true, source_url: clean(b.sourceUrl, 500) || null },
      });
      stored = true;
    } catch (e) {
      console.error('[ko/application] full application not stored', reference, e && e.message);
    }
    await insertNote(deal.id, stored
      ? `Online application ${reference} received via /ko/apply. Full application saved.`
      : `Online application ${reference} received via /ko/apply. Full details could not be saved; call the customer to complete.`,
      AUTHOR);
    return res.status(200).json({ ok: true, reference });
  } catch (err) {
    console.error('[ko/application] save failed', reference, err && err.message);
    return res.status(502).json({ ok: false, reference, error: 'We could not save your application. Please call us quoting your reference.' });
  }
};
