/* global React */
// Minimal shared bits for the standalone KO pages (copied, not imported).
function BrandLogo({ size = 'md' }) {
  const fs = size === 'lg' ? 26 : size === 'sm' ? 17 : 21;
  return <span className="brand-logo" style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: fs, letterSpacing: '.02em', color: 'var(--ink)' }}>KO <span style={{ color: 'var(--gold-2)' }}>Deal Tracker</span></span>;
}
function formatMoney(n) { return Math.round(Number(n) || 0).toLocaleString('en-AU'); }
function isValidAUPhone(v) { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('61')) d = '0' + d.slice(2); return /^0[2-478]\d{8}$/.test(d); }
function isValidEmail(v) { return /^\S+@\S+\.\S+$/.test(String(v || '').trim()); }
Object.assign(window, { BrandLogo, formatMoney, isValidAUPhone, isValidEmail });
