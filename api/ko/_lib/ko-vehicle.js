// Reads a vehicle off the KO Cars website (kocarsandcommercials.com.au) for the
// invoice request. The site is an EasyCars dealer site with no API, so this
// scrapes the public pages:
//
//   /list-view/pagenum-N          the stock list, ~10 cars a page
//   /vehicle-list-view/<slug>     one car, with a details table of
//                                 <tr data-value="VIN"><td>VIN</td><td>...</td></tr>
//
// The data-value keys are EasyCars' own field names, so they are the stable
// part of the markup. If KO Cars change website provider this file breaks and
// the invoice form still works: every field it fills is editable by hand.
//
// Only ever fetches this one host. The caller's input is matched against what
// the site returns, never used to build a URL on another host, so this can't
// be pointed at anything else.

const HOST = 'www.kocarsandcommercials.com.au';
const BASE = `https://${HOST}`;
const MAX_LIST_PAGES = 8;
const MAX_DETAIL_FETCHES = 60;
const FETCH_TIMEOUT_MS = 8000;

async function getHtml(path) {
  const res = await fetch(BASE + path, {
    headers: { 'User-Agent': 'BrokenMind-KO/1.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`KO Cars site returned ${res.status} for ${path}`);
  return res.text();
}

function decode(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Accepts a pasted listing link. Returns the path, or null if it isn't a
// KO Cars vehicle page.
function listingPath(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host !== HOST && host !== HOST.replace(/^www\./, '')) return null;
  if (!/^\/vehicle[\w-]*\//.test(u.pathname)) return null;
  return u.pathname;
}

// One car's details table -> a flat object.
function parseDetail(html, path) {
  const fields = {};
  const re = /<tr[^>]*data-value="([^"]+)"[^>]*>\s*<td>[\s\S]*?<\/td>\s*<td>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html))) fields[m[1]] = decode(m[2]);

  // "Price" holds the figure plus an "Excl. Govt. Charges" span.
  const priceMatch = (fields.Price || '').match(/\$[\d,]+(?:\.\d{2})?/);
  const price = priceMatch ? priceMatch[0] : '';
  const drive = /excl/i.test(fields.Price || '') ? ' + ORC' : '';

  return {
    title: fields.Title || '',
    stock: fields.StockNumber || '',
    vin: fields.VIN || '',
    rego: fields.RegistrationNumber || '',
    rego_expiry: fields.RegistrationExpiry || '',
    colour: fields.Colour || '',
    odometer: fields.Odometer || '',
    transmission: fields.Transmission || '',
    body: fields.Body || '',
    price: price ? price + drive : '',
    url: BASE + path,
  };
}

// Every listing on the stock list: [{ path, title, price }].
async function listStock() {
  const first = await getHtml('/list-view/pagenum-1');
  const pageNums = [...first.matchAll(/\/list-view\/pagenum-(\d+)/g)].map((m) => Number(m[1]));
  const lastPage = Math.min(MAX_LIST_PAGES, Math.max(1, ...pageNums));

  const pages = [first];
  const rest = [];
  for (let n = 2; n <= lastPage; n += 1) rest.push(getHtml(`/list-view/pagenum-${n}`));
  pages.push(...(await Promise.all(rest)));

  const seen = new Map();
  for (const html of pages) {
    const re = /<div class='search_title[^']*'><a href='(\/vehicle[^']+)'>([\s\S]*?)<\/a>[\s\S]*?class="vehicle-price">([^<]*)</g;
    let m;
    while ((m = re.exec(html))) {
      if (!seen.has(m[1])) seen.set(m[1], { path: m[1], title: decode(m[2]), price: decode(m[3]) });
    }
  }
  return [...seen.values()];
}

// Main entry.
//   q:    a stock number, rego, VIN, or a pasted listing link
//   hint: { year, make, model } from the deal, used when q finds nothing
// Returns { vehicle } on a single match, else { candidates } for Josh to pick.
async function lookupVehicle(q, hint = {}) {
  const input = String(q || '').trim();

  const direct = input && listingPath(input);
  if (direct) return { vehicle: parseDetail(await getHtml(direct), direct) };

  const stock = await listStock();

  if (input) {
    // Stock number / rego / VIN only live on the detail pages, so read them.
    const wanted = norm(input);
    const details = await Promise.all(stock.slice(0, MAX_DETAIL_FETCHES).map(async (s) => {
      try { return parseDetail(await getHtml(s.path), s.path); } catch { return null; }
    }));
    const hit = details.find((d) => d && [d.stock, d.rego, d.vin].some((v) => v && norm(v) === wanted));
    if (hit) return { vehicle: hit };
  }

  // Nothing typed, or nothing matched: offer the cars that look like the deal.
  const words = [hint.year, hint.make, hint.model].map(norm).filter(Boolean);
  const scored = stock
    .map((s) => ({ ...s, score: words.filter((w) => norm(s.title).includes(w)).length }))
    .filter((s) => !words.length || s.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    candidates: scored.slice(0, 12).map((s) => ({ title: s.title, price: s.price, url: BASE + s.path })),
    searched: input || null,
  };
}

module.exports = { lookupVehicle, listingPath, parseDetail };
