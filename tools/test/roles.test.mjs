import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

// The whole read-only promise to Autozone rests on these: their password must never mint a session
// that can write, and a role must not be editable in the browser.
test('each password mints its own role, and the role cannot be tampered with', async () => {
  process.env.AZ_STAFF_PASSWORD = 'window cards password'
  process.env.AZ_BAG_PASSWORD = 'buyer assist password'
  delete process.env.AZ_DEV_NO_AUTH
  delete process.env.AZ_SESSION_SECRET
  const { roleFor, sessionCookie, roleOf, canWrite, isAuthed, ROLE_AZ, ROLE_BAG } =
    await import('../../api/_lib/auth.js?roles')

  assert.equal(roleFor('window cards password'), ROLE_AZ)
  assert.equal(roleFor('buyer assist password'), ROLE_BAG)
  assert.equal(roleFor('neither'), null)
  assert.equal(roleFor(''), null)
  assert.equal(roleFor(undefined), null)

  const az = { headers: { cookie: sessionCookie(ROLE_AZ).split(';')[0] } }
  const bag = { headers: { cookie: sessionCookie(ROLE_BAG).split(';')[0] } }
  assert.equal(roleOf(az), ROLE_AZ)
  assert.equal(roleOf(bag), ROLE_BAG)
  assert.equal(canWrite(az), false, 'Autozone must stay read-only')
  assert.equal(canWrite(bag), true)
  assert.ok(isAuthed(az) && isAuthed(bag), 'both roles get into the window-card app')

  // Editing the role in the cookie breaks the signature, so it is refused outright rather than
  // downgraded to a valid session.
  const forged = { headers: { cookie: az.headers.cookie.replace('.az.', '.bag.') } }
  assert.equal(roleOf(forged), null)
  assert.equal(canWrite(forged), false)

  // An unknown role name is not a session at all.
  assert.equal(roleOf({ headers: { cookie: az.headers.cookie.replace('.az.', '.boss.') } }), null)

  // Simply deleting the role from a role-signed cookie breaks the signature, as it should.
  assert.equal(roleOf({ headers: { cookie: az.headers.cookie.replace(/=(\d+)\.az\./, '=$1.') } }), null)

  // A genuine session issued before roles existed carried no role part and was signed over the
  // expiry alone. Those are still honoured, as Autozone, so deploying this does not log the
  // dealership out of the window-card app mid-week.
  const exp = Date.now() + 864e5
  const legacyMac = createHmac('sha256', 'azcards-v1|' + process.env.AZ_STAFF_PASSWORD).update(String(exp)).digest('base64url')
  assert.equal(roleOf({ headers: { cookie: 'az_session=' + exp + '.' + legacyMac } }), ROLE_AZ)
  assert.equal(canWrite({ headers: { cookie: 'az_session=' + exp + '.' + legacyMac } }), false)

  process.env.AZ_STAFF_PASSWORD = 'changed'
  assert.equal(roleOf(bag), null, 'changing the password logs everyone out')
})

test('the read-only wrapper refuses a write from Autozone and lets Buyer Assist through', async () => {
  process.env.AZ_STAFF_PASSWORD = 'window cards password'
  process.env.AZ_BAG_PASSWORD = 'buyer assist password'
  delete process.env.AZ_DEV_NO_AUTH
  const { staffOnly } = await import('../../api/_lib/http.js?roles')
  const { sessionCookie, ROLE_AZ, ROLE_BAG } = await import('../../api/_lib/auth.js?roles')

  const handler = staffOnly(async (req, res, role) => { res.statusCode = 200; res.end(JSON.stringify({ role })) },
    { methods: ['POST'], write: true })

  const run = async role => {
    const req = { method: 'POST', headers: { cookie: sessionCookie(role).split(';')[0], 'content-type': 'application/json' }, body: {} }
    let status = 0, body = ''
    const res = { setHeader() {}, end(b) { body = b }, headersSent: false, get statusCode() { return status }, set statusCode(v) { status = v } }
    await handler(req, res)
    return { status, body: JSON.parse(body) }
  }

  const az = await run(ROLE_AZ)
  assert.equal(az.status, 403)
  assert.match(az.body.error, /read-only/i)

  const bag = await run(ROLE_BAG)
  assert.equal(bag.status, 200)
  assert.equal(bag.body.role, ROLE_BAG)
})
