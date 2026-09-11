import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientKey, lockedFor, afterFail, triesLeft, prune, lockMessage, MAX_FAILS, WINDOW_MS, LOCK_MS } from '../../api/_lib/lockout.js'

test('five wrong passwords within 15 minutes locks the address for 15 minutes', () => {
  let rec, now = 1_000_000
  for (let i = 1; i < MAX_FAILS; i++) {
    rec = afterFail(rec, now += 1000)
    assert.equal(lockedFor(rec, now), 0, 'not locked after ' + i)
    assert.equal(triesLeft(rec), MAX_FAILS - i)
  }
  rec = afterFail(rec, now += 1000)
  assert.equal(lockedFor(rec, now), LOCK_MS)
  assert.equal(lockedFor(rec, now + LOCK_MS - 1), 1)
  assert.equal(lockedFor(rec, now + LOCK_MS), 0, 'unlocks after 15 minutes')
})

test('wrong passwords spread over more than 15 minutes never lock', () => {
  let rec, now = 0
  for (let i = 0; i < 20; i++) { rec = afterFail(rec, now += WINDOW_MS / 3); assert.equal(lockedFor(rec, now), 0) }
})

test('after a lock expires the count starts again from zero', () => {
  let rec, now = 0
  for (let i = 0; i < MAX_FAILS; i++) rec = afterFail(rec, ++now)
  now += LOCK_MS
  rec = afterFail(rec, now)
  assert.equal(lockedFor(rec, now), 0)
  assert.equal(triesLeft(rec), MAX_FAILS - 1)
})

test('addresses are hashed, and x-real-ip / x-forwarded-for are read', () => {
  const a = clientKey({ headers: { 'x-real-ip': '203.0.113.9' } })
  assert.equal(a, clientKey({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }))
  assert.notEqual(a, clientKey({ headers: { 'x-real-ip': '203.0.113.10' } }))
  assert.ok(!a.includes('203'), 'raw IP is never stored')
  assert.match(a, /^[0-9a-f]{32}$/)
})

test('prune keeps live records and drops stale ones', () => {
  const now = 10 * WINDOW_MS
  const map = {
    recent: { fails: [now - 1000] },
    stale: { fails: [now - WINDOW_MS - 1] },
    locked: { fails: [], lockedUntil: now + 5000 },
    expired: { fails: [], lockedUntil: now - 1 }
  }
  assert.deepEqual(Object.keys(prune(map, now)).sort(), ['locked', 'recent'])
})

test('lock message counts minutes', () => {
  assert.equal(lockMessage(LOCK_MS), 'Too many wrong passwords. Try again in 15 minutes.')
  assert.equal(lockMessage(20 * 1000), 'Too many wrong passwords. Try again in 1 minute.')
})
