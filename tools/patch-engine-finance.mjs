// Stamps api/_lib/finance.js into the generated card engine.
// The Card Studio remains the source for the card's layout. The repayment terms and the
// disclaimer wording are overwritten from the shared module so a studio rebuild cannot
// leave the card on a different deposit, rate, term or fee from the photo.

import { engineDefFinanceLine, engineDisclaimerSource } from '../api/_lib/finance.js'

const DEF_LINE = /dep:\s*[\d.]+,\s*rate:\s*[\d.]+,\s*term:\s*\d+,\s*fee:\s*[\d.]+,\s*balloon:\s*[\d.]+,\s*round:\s*\d+,\s*showRate:\s*(?:true|false)/

function replaceFunction(html, name, source) {
  const start = html.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('Could not find function ' + name + ' in the card engine')
  let i = html.indexOf('{', start)
  if (i < 0) throw new Error('Could not find the body of ' + name)
  let depth = 0
  for (; i < html.length; i++) {
    const c = html[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) { i++; break }
    }
  }
  if (depth !== 0) throw new Error('Unbalanced braces in ' + name)
  return html.slice(0, start) + source.trim() + html.slice(i)
}

export function patchEngineFinance(html) {
  if (!DEF_LINE.test(html)) throw new Error('Could not find the finance defaults in the card engine')
  html = html.replace(DEF_LINE, engineDefFinanceLine())
  html = replaceFunction(html, 'disclaimer', engineDisclaimerSource())
  return html
}
