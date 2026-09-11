// What the window in the yard shows versus what the website says.
//
// `state.printed` is the set of cards that are physically up in windows, keyed by listing id, holding
// exactly what was printed on each. Comparing that with the live website gives every car a status.

// Anything that changes what the printed card shows. Odometer is compared separately with a
// tolerance, so a few km of test drives doesn't demand a reprint.
const CARD_FIELDS = ['title', 'year', 'price', 'transmission', 'fuel', 'drive', 'warranty', 'short']
const KM_TOLERANCE = 1000

/** Dealer titles carry emoji and sales lines ("2019 Isuzu D-max SX 🔥Many After Market Extras..."). */
export function cleanTitle(raw) {
  let s = String(raw || '')
  const cut = s.search(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u)
  if (cut > 0) s = s.slice(0, cut)
  s = s.replace(/christmas special/gi, ' ').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/[\s\-|:,+]+$/, '')
  return s.split(' ').map(w => {
    if (/^\(?\d+x\d+\)?$/i.test(w)) return w.toLowerCase()                       // 4X4 -> 4x4
    if (/^[A-Z]{4,}(-[A-Z]{2,})*$/.test(w))                                      // TOYOTA -> Toyota, MERCEDES-BENZ -> Mercedes-Benz
      return w.split('-').map(p => p[0] + p.slice(1).toLowerCase()).join('-')
    return w
  }).join(' ')
}

export function titleFor(car, state) {
  // a name fixed by staff in the app, then the Card Studio name for this exact listing, then the website's
  return (state.titles && state.titles[car.id]) || (state.seedTitles && state.seedTitles[car.id]) || cleanTitle(car.rawTitle)
}

/** The fields the card engine needs, in the shape the Card Studio's STOCK used. */
export function cardData(car, state) {
  return {
    id: car.id, url: car.url, short: car.short, title: titleFor(car, state), price: car.price,
    odometer: car.odometer, year: car.year, make: car.make, model: car.model,
    transmission: car.transmission, fuel: car.fuel, drive: car.drive, engine: car.engine,
    doors: car.doors, colour: car.colour, body: '', seats: '', vin: car.vin, warranty: car.warranty
  }
}

export function printedEntry(car, state, at) {
  const d = cardData(car, state)
  return { id: d.id, vin: d.vin, title: d.title, year: d.year, price: d.price, odometer: d.odometer,
    transmission: d.transmission, fuel: d.fuel, drive: d.drive, warranty: d.warranty, short: d.short,
    make: d.make, model: d.model, printedAt: at }
}

const money = n => '$' + Number(n || 0).toLocaleString('en-AU')
const km = n => Number(n || 0).toLocaleString('en-AU') + ' km'

function differences(was, now) {
  const out = []
  for (const f of CARD_FIELDS) {
    if (String(was[f] ?? '') === String(now[f] ?? '')) continue
    if (f === 'price') out.push('Price ' + money(was.price) + ' → ' + money(now.price))
    else if (f === 'short') out.push('Listing link changed')
    else if (f === 'title') out.push('Name changed')
    else if (f === 'year') out.push('Year ' + was.year + ' → ' + now.year)
    else if (f === 'warranty') out.push(now.warranty ? 'Warranty added' : 'Warranty removed')
    else out.push(f[0].toUpperCase() + f.slice(1) + ' changed')
  }
  if (Math.abs(Number(was.odometer || 0) - Number(now.odometer || 0)) >= KM_TOLERANCE)
    out.push('Kms ' + km(was.odometer) + ' → ' + km(now.odometer))
  return out
}

/** Same car under a new listing: VIN first, then year/make/model with near-identical kms. */
function sameVehicle(p, car) {
  if (p.vin && car.vin) return p.vin.toUpperCase() === car.vin.toUpperCase()
  return String(p.year) === String(car.year) && p.make.toLowerCase() === car.make.toLowerCase() &&
    p.model.toLowerCase() === car.model.toLowerCase() &&
    Math.abs(Number(p.odometer || 0) - Number(car.odometer || 0)) < 2000
}

/**
 * statuses:
 *   new       on the website, no card printed
 *   relisted  the dealer re-posted a car that has a card: the QR on that card now goes to a 404
 *   changed   card printed, but the price / name / details have moved since
 *   ok        card matches the website
 * sold: cards printed for cars no longer on the website (take them out of the window)
 */
export function reconcile(liveCars, state) {
  const printed = state.printed || {}
  const liveIds = new Set(liveCars.map(c => c.id))
  const orphans = Object.values(printed).filter(p => !liveIds.has(p.id))
  const claimed = new Set()

  const titles = state.titles || {}
  const cars = liveCars.map(car => {
    const p = printed[car.id]
    const old = p ? null : orphans.find(o => !claimed.has(o.id) && sameVehicle(o, car))
    if (old) claimed.add(old.id)
    // a name staff fixed follows the car to its new listing (with the year kept in step)
    const carried = old && !titles[car.id] && titles[old.id] &&
      (car.year ? titles[old.id].replace(/^(19|20)\d{2}\b/, car.year) : titles[old.id])
    const card = cardData(car, carried ? { ...state, titles: { ...titles, [car.id]: carried } } : state)
    let status = 'ok', changes = [], replaces = null
    if (p) {
      changes = differences(p, card)
      if (changes.length) status = 'changed'
    } else if (old) {
      replaces = old.id; status = 'relisted'
      changes = ['Re-listed on the website: the QR on the old card goes to a dead page']
        .concat(differences({ ...old, short: card.short }, card))
    } else status = 'new'
    return { ...card, rawTitle: car.rawTitle, photo: car.photo, status, changes, replaces,
      printedAt: p ? p.printedAt : null, titleEdited: !!(state.titles && state.titles[car.id]) }
  })

  // The dealer sometimes posts a car a second time without taking the first listing down.
  // Flag it so staff check before printing a second card for the same car.
  for (const c of cars.filter(c => c.status === 'new' && c.vin)) {
    const twin = cars.find(o => o !== c && printed[o.id] && o.vin && o.vin.toUpperCase() === c.vin.toUpperCase())
    if (twin) {
      c.duplicateOf = twin.id
      c.changes = ['Same VIN as another listing that already has a card (' + twin.title + '). Probably a duplicate listing: check with the dealer before printing.']
    }
  }

  const sold = orphans.filter(o => !claimed.has(o.id))
    .map(o => ({ id: o.id, title: o.title, year: o.year, price: o.price, printedAt: o.printedAt }))
  return { cars, sold }
}

/** Records cards as being in the window. Used by the update and PDF routes. */
export function markPrinted(state, liveCars, ids, how) {
  const { cars } = reconcile(liveCars, state)
  const at = new Date().toISOString()
  const undo = { printed: {} }
  const done = []
  for (const car of cars.filter(c => ids.includes(c.id))) {
    undo.printed[car.id] = state.printed[car.id] || null
    if (car.replaces) {
      undo.printed[car.replaces] = state.printed[car.replaces] || null
      delete state.printed[car.replaces]
      state.titles ||= {}
      if (!state.titles[car.id] && state.titles[car.replaces]) state.titles[car.id] = car.title
      delete state.titles[car.replaces]
    }
    state.printed[car.id] = printedEntry(car, state, at)
    done.push(car.title)
  }
  state.undo = done.length ? undo : state.undo
  return done.length ? { action: how, ids, text: how + ': ' + done.join(', ') } : null
}
