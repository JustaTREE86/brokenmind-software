import { test } from 'node:test'
import assert from 'node:assert/strict'

test('session cookie round trip, tamper and password checks', async () => {
  process.env.AZ_STAFF_PASSWORD = 'correct horse battery'
  delete process.env.AZ_DEV_NO_AUTH
  const { sessionCookie, isAuthed, passwordOk, devBypass } = await import('../../api/_lib/auth.js')
  const cookie = sessionCookie().split(';')[0]
  assert.ok(isAuthed({ headers: { cookie: 'x=1; ' + cookie } }))
  assert.ok(!isAuthed({ headers: { cookie: cookie.replace(/.$/, c => c === 'A' ? 'B' : 'A') } }))
  assert.ok(!isAuthed({ headers: {} }))
  assert.ok(passwordOk('correct horse battery'))
  assert.ok(!passwordOk('correct horse'))
  process.env.AZ_DEV_NO_AUTH = '1'
  const local = { headers: { host: 'localhost:3007' } }, live = { headers: { host: 'brokenmind.com.au' } }
  delete process.env.VERCEL_ENV
  assert.ok(devBypass(local))
  assert.ok(!devBypass(live), 'bypass needs a localhost request')
  process.env.VERCEL_ENV = 'production'
  assert.ok(!devBypass(local), 'bypass must never work on a deployed site')
  process.env.VERCEL_ENV = 'preview'
  assert.ok(!devBypass(local))
  process.env.AZ_STAFF_PASSWORD = 'changed'
  assert.ok(!isAuthed({ headers: { cookie } }), 'changing the password logs everyone out')
})
