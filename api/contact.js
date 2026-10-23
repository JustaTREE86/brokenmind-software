const hits = new Map();
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (list.length >= 5) return res.status(429).json({ ok: false, error: 'Easy tiger, try again in a few minutes.' });
  list.push(now); hits.set(ip, list);
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const name = String(b.name || '').trim(), email = String(b.email || '').trim(), need = String(b.need || '').trim(), topic = String(b.topic || 'Not sure yet').trim().slice(0, 80);
  // honeypot + time check: silently accept bots
  if (b.website || !b.t || now - Number(b.t) < 3000 || now - Number(b.t) > 86400000) return res.status(200).json({ ok: true });
  if (name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200 || need.length < 5 || need.length > 4000)
    return res.status(400).json({ ok: false, error: 'Check your name, email and message and try again.' });
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Broken Mind Website <noreply@canigetfinance.com.au>',
      to: [process.env.CONTACT_TO], reply_to: email,
      subject: `New Broken Mind enquiry (${topic}) from ${name.slice(0, 60)}`,
      html: `<p><b>Name:</b> ${esc(name)}<br><b>Email:</b> ${esc(email)}</p><p><b>What they're after:</b> ${esc(topic)}</p><p><b>What they need:</b><br>${esc(need).replace(/\n/g, '<br>')}</p>`
    })
  });
  if (!r.ok) return res.status(502).json({ ok: false, error: 'Couldn\'t send right now. Try Messenger instead.' });
  const j = await r.json();
  return res.status(200).json({ ok: true, id: j.id });
}
