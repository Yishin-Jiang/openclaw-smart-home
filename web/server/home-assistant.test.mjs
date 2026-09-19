import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyCameraState } from './home-assistant.mjs'

const now = Date.parse('2026-09-15T12:00:00.000Z')
const offlineMs = 5 * 60 * 1000

test('G350 restart stays pending while the first stream probe has no result', () => {
  assert.deepEqual(classifyCameraState('idle', undefined, now, offlineMs), {
    status: 'unknown',
    label: '連線待確認',
    reason: 'stream-probe-pending',
  })
})

test('G350 idle becomes connected only after a successful stream probe', () => {
  assert.deepEqual(classifyCameraState('idle', { reachable: true }, now, offlineMs), {
    status: 'on',
    label: '連線正常',
    reason: null,
  })
})

test('one failed probe does not fall back to the stale idle metadata', () => {
  const result = classifyCameraState('idle', {
    reachable: false,
    failureCount: 1,
    failureSince: '2026-09-15T11:59:00.000Z',
  }, now, offlineMs)
  assert.equal(result.status, 'unknown')
  assert.equal(result.reason, 'stream-probe-failed')
})

test('repeated failures remain pending until the five-minute boundary', () => {
  const result = classifyCameraState('idle', {
    reachable: false,
    failureCount: 2,
    failureSince: '2026-09-15T11:55:01.000Z',
  }, now, offlineMs)
  assert.equal(result.status, 'unknown')
  assert.equal(result.label, '連線待確認')
})

test('repeated failures at the five-minute boundary become offline', () => {
  const result = classifyCameraState('idle', {
    reachable: false,
    failureCount: 2,
    failureSince: '2026-09-15T11:55:00.000Z',
  }, now, offlineMs)
  assert.deepEqual(result, {
    status: 'offline',
    label: '離線',
    reason: 'stream-probe-failed',
  })
})

test('Home Assistant unavailable is immediately reported without trusting idle history', () => {
  assert.deepEqual(classifyCameraState('unavailable', { reachable: true }, now, offlineMs), {
    status: 'offline',
    label: '離線',
    reason: 'ha-unavailable',
  })
})
