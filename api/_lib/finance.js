// The one place the Autozone repayment terms live.
//
// Window cards and repayment photos both use this. Change the numbers here, then run
// `npm run engine` so autozone/engine.html (the generated card) picks them up. The photo
// renderer imports this file directly, so the two cannot drift apart.

export const FINANCE = {
  dep: 20,       // deposit, percent of the advertised price
  rate: 9.49,    // annual percentage rate
  term: 84,      // months
  fee: 900,      // dollars of fees financed
  balloon: 0,    // dollars owing at the end
  round: 1,      // weekly figure rounded to this many dollars
  showRate: false
}

export function num(v) {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Same weekly repayment the card engine prints. Rounded to FINANCE.round dollars. */
export function weeklyFor(price, terms = FINANCE) {
  const p = num(price)
  if (!p) return 0
  const dep = p * (num(terms.dep) / 100)
  const principal = p - dep + num(terms.fee)
  const n = Math.max(1, Math.round(num(terms.term)))
  const i = num(terms.rate) / 100 / 12
  const bal = num(terms.balloon)
  const monthly = i <= 0
    ? (principal - bal) / n
    : (principal - bal / Math.pow(1 + i, n)) * i / (1 - Math.pow(1 + i, -n))
  const w = monthly * 12 / 52
  const r = num(terms.round) || 1
  return Math.max(0, Math.round(w / r) * r)
}

function money(n) {
  return '$' + Math.round(num(n)).toLocaleString('en-AU')
}

/**
 * The repayment disclaimer, filled from the terms above.
 * Printed in full on every window card. The interest rate is part of this sentence.
 */
export function repaymentDisclaimer(terms = FINANCE) {
  const balloon = num(terms.balloon)
  const balloonText = balloon ? 'a ' + money(balloon) + ' balloon' : 'no balloon'
  return 'Weekly repayment is an estimate only, based on ' + num(terms.dep) + '% deposit, ' +
    num(terms.rate) + '% p.a. over ' + Math.round(num(terms.term)) +
    ' months with ' + money(terms.fee) + ' fees financed and ' + balloonText +
    '. Excludes government charges. Subject to lending criteria, fees and charges apply. Not a quote or offer of finance.'
}

/**
 * Short form of the same terms, for the photo only. The card keeps the full sentence.
 * Bump PHOTO_STYLE when the picture layout changes so stored jpegs are made again.
 */
export const PHOTO_STYLE = 5

export function photoCaptionLines(terms = FINANCE) {
  const balloon = num(terms.balloon)
  const balloonText = balloon ? money(balloon) + ' balloon' : 'no balloon'
  return [
    'Est. only. ' + num(terms.dep) + '% dep, ' + num(terms.rate) + '% p.a., ' +
      Math.round(num(terms.term)) + ' mths, ' + money(terms.fee) + ' fees, ' + balloonText +
      '. T&Cs apply. Not a quote.'
  ]
}

/** Fingerprint stored with each photo, so a terms or layout change regenerates every image. */
export function termsKey(terms = FINANCE) {
  return [terms.dep, terms.rate, terms.term, terms.fee, terms.balloon, terms.round, PHOTO_STYLE].join('|')
}

/** Card-engine DEF line. `npm run engine` writes this over the studio's copy. */
export function engineDefFinanceLine(terms = FINANCE) {
  return 'dep:' + terms.dep + ', rate:' + terms.rate + ', term:' + terms.term +
    ', fee:' + terms.fee + ', balloon:' + terms.balloon + ', round:' + terms.round +
    ', showRate:' + (terms.showRate ? 'true' : 'false')
}

/**
 * Replacement for the studio's disclaimer(). It reads S (the engine's settings, which
 * `npm run engine` sets from FINANCE) and keeps the warranty and credit-licence lines
 * the card already carried.
 */
export function engineDisclaimerSource() {
  return `function disclaimer(price, weekly, warranty){
  var fee = Math.round(num(S.fee));
  var balloon = num(S.balloon);
  var text = 'Weekly repayment is an estimate only, based on ' + num(S.dep) + '% deposit, ' + num(S.rate) + '% p.a. over ' + Math.round(num(S.term)) + ' months with $' + fee.toLocaleString('en-AU') + ' fees financed and ' + (balloon ? ('a ' + money(balloon) + ' balloon') : 'no balloon') + '. Excludes government charges. Subject to lending criteria, fees and charges apply. Not a quote or offer of finance.';
  if (warranty) text += ' ' + warranty + ' refers to a mechanical breakdown warranty arranged through AWN. It is not insurance. Cover, eligibility, terms, conditions and exclusions apply — ask for the Product Disclosure Statement before you buy. It is in addition to your rights under the Australian Consumer Law and to any dealer statutory warranty that applies.';
  if (S.acl) text += ' ' + S.acl + '.';
  return text;
}`
}
