import { expect, test } from 'claude-code/testing'

import { autoDelay, nextPace, SETTLE_MS } from './pace'

test('git の読み取りが遅ければかかった時間だけ空け、30 秒で頭打ちにし、速ければ空けない', () => {
  const start = { waitMs: 0, unavailable: 0 }
  expect(nextPace(100, start)).toEqual({ waitMs: 0, unavailable: 0 })
  expect(nextPace(800, start)).toEqual({ waitMs: 800, unavailable: 0 })
  expect(nextPace(45_000, start)).toEqual({ waitMs: 30_000, unavailable: 0 })
})

test('git が時間切れになるたびに 10 秒から倍にして 1 分で頭打ちにし、読めたら元に戻す', () => {
  let pace = { waitMs: 0, unavailable: 0 }
  const waits: number[] = []
  for (let i = 0; i < 5; i++) {
    pace = nextPace(null, pace)
    waits.push(pace.waitMs)
  }
  expect(waits).toEqual([10_000, 20_000, 40_000, 60_000, 60_000])
  expect(nextPace(20, pace)).toEqual({ waitMs: 0, unavailable: 0 })
})

test('書き換えのあとの読み直しは、少なくともまとめる時間だけ待ち、空ける時間が残っていればそれまで待つ', () => {
  expect(autoDelay(1000, 0)).toBe(SETTLE_MS)
  expect(autoDelay(1000, 5000)).toBe(4000)
})
