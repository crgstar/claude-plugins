import { expect, test } from 'claude-code/testing'
import { POLL_MS, decide, nextBackoff, overlayHeaderLimits, retryAfterMs } from './policy.ts'

const T0 = 1_000_000_000_000
const MIN = 60_000
const W = [
  { title: 'Current session', short: 'Session', percent: 10, resetsAt: 'a', periodMs: 1 },
  { title: 'Current week (all models)', short: 'Week', percent: 3, resetsAt: 'b', periodMs: 1 },
  { title: 'Current week (Fable)', short: 'Fable', percent: 0, resetsAt: 'c', periodMs: 1 },
]

test('decide は待ち中なら呼ばず、5 分以内の共有結果があれば使い、それ以外で呼ぶ', () => {
  const fresh = { windows: W, fetchedAtMs: T0 }
  expect(decide(undefined, undefined, T0)).toBe('fetch')
  expect(decide(fresh, undefined, T0 + POLL_MS - 1)).toBe('use-cache')
  expect(decide(fresh, undefined, T0 + POLL_MS)).toBe('fetch')
  expect(decide(undefined, { retryAtMs: T0 + MIN, lastDelayMs: MIN }, T0)).toBe('wait')
  expect(decide(fresh, { retryAtMs: T0 + 10 * MIN, lastDelayMs: MIN }, T0 + POLL_MS)).toBe('wait')
  expect(decide(undefined, { retryAtMs: T0, lastDelayMs: MIN }, T0)).toBe('fetch')
})

test('retryAfterMs は秒数と HTTP 日付を読み、読めなければ undefined', () => {
  expect(retryAfterMs('120', T0)).toBe(120_000)
  expect(retryAfterMs(new Date(T0 + 30_000).toUTCString(), T0)).toBe(30_000)
  expect(retryAfterMs('junk', T0)).toBe(undefined)
  expect(retryAfterMs(undefined, T0)).toBe(undefined)
})

test('nextBackoff は指定があれば従い、無ければ 5 分から倍々で 60 分まで延ばす', () => {
  expect(nextBackoff(undefined, 90_000, T0)).toEqual({ retryAtMs: T0 + 90_000, lastDelayMs: 90_000 })
  const first = nextBackoff(undefined, undefined, T0)
  expect(first.lastDelayMs).toBe(5 * MIN)
  expect(nextBackoff(first, undefined, T0).lastDelayMs).toBe(10 * MIN)
  expect(nextBackoff({ retryAtMs: 0, lastDelayMs: 40 * MIN }, undefined, T0).lastDelayMs).toBe(60 * MIN)
})

test('overlayHeaderLimits は Session と Week だけをヘッダの値で上書きし、小数は切り捨てる', () => {
  const out = overlayHeaderLimits(W, [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: 'x' },
    { kind: 'seven_day', percentUsed: 7 },
    { kind: 'spend_limit', percentUsed: 50 },
  ])
  expect(out.map((w) => [w.short, w.percent, w.resetsAt])).toEqual([
    ['Session', 23, 'x'],
    ['Week', 7, 'b'],
    ['Fable', 0, 'c'],
  ])
})
