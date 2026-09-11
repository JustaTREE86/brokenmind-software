import { staffOnly, send } from '../_lib/http.js'
import { readCompleteStock, updateState } from '../_lib/store.js'
import { markPrinted } from '../_lib/cards.js'

const idList = ids => (Array.isArray(ids) ? ids : []).map(String).filter(id => /^\d{1,10}$/.test(id))

// POST /api/autozone/update  { action, ids?, id?, title? }
//   printed    cards printed and put in windows
//   removed    sold cars' cards taken out of windows
//   title      fix how a car's name reads on its card ('' puts the website's name back)
//   undo       reverse the last printed/removed
export default staffOnly(async (req, res) => {
  const b = req.body || {}
  const ids = idList(b.ids)
  let live = null
  if (b.action === 'printed') live = (await readCompleteStock()).cars

  const state = await updateState(state => {
    state.printed ||= {}; state.titles ||= {}
    switch (b.action) {
      case 'printed':
        return markPrinted(state, live, ids, 'Printed')
      case 'removed': {
        const undo = { printed: {} }, names = []
        for (const id of ids) if (state.printed[id]) { undo.printed[id] = state.printed[id]; names.push(state.printed[id].title); delete state.printed[id] }
        if (!names.length) return null
        state.undo = undo
        return { action: 'removed', ids, text: 'Taken out of window: ' + names.join(', ') }
      }
      case 'title': {
        const id = idList([b.id])[0]
        const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 80)
        if (!id) throw new Error('Which car?')
        state.seedTitles ||= {}
        if (title) state.titles[id] = title
        else { delete state.titles[id]; delete state.seedTitles[id] }      // back to the website's own name
        return { action: 'title', ids: [id], text: title ? 'Renamed to "' + title + '"' : 'Name reset to the website' }
      }
      case 'undo': {
        if (!state.undo) return null
        for (const [id, entry] of Object.entries(state.undo.printed)) {
          if (entry) state.printed[id] = entry; else delete state.printed[id]
        }
        state.undo = null
        return { action: 'undo', ids: [], text: 'Undid the last change' }
      }
      default:
        throw new Error('Unknown action')
    }
  })
  send(res, 200, { ok: true, canUndo: !!state.undo })
}, { methods: ['POST'] })
