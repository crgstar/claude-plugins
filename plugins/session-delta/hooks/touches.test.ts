import { expect, test } from 'claude-code/testing'

import { KEEP_MS, parseRecord, planBase, staleSessions, touchKey, writtenPath } from './touches'

test('鍵はパスごとに決まった 16 桁で、パスが違えば違う', () => {
  expect(touchKey('/r/a.ts')).toBe(touchKey('/r/a.ts'))
  expect(touchKey('/r/a.ts')).toMatch(/^[0-9a-f]{16}$/)
  expect(touchKey('/r/a.ts')).not.toBe(touchKey('/r/b.ts'))
})

test('記録は path・既知の state・呼び出しの ID があるものだけ読む', () => {
  expect(parseRecord('{"path":"/r/a.ts","state":"text","toolUseId":"t1"}')).toEqual({ path: '/r/a.ts', state: 'text', toolUseId: 't1' })
  expect(parseRecord('{"path":"/r/a.ts","state":"text"}')).toBe(null)
  expect(parseRecord('{"path":"/r/a.ts","state":"other","toolUseId":"t1"}')).toBe(null)
  expect(parseRecord('{"state":"text","toolUseId":"t1"}')).toBe(null)
  expect(parseRecord('{')).toBe(null)
})

test('記録があれば記録で、無ければ会話の記録の中身で決め、どちらも無ければ比較不可', () => {
  const at = (state: 'text' | 'absent' | 'large' | 'unreadable') => ({ state, toolUseId: 't1' })
  const touch = (base: string | null) => ({ base, later: [] })
  expect(planBase(at('text'), touch(null))).toEqual({ kind: 'record' })
  expect(planBase(at('text'), undefined)).toEqual({ kind: 'record' })
  expect(planBase(at('absent'), touch('x0'))).toEqual({ kind: 'base', base: '' })
  expect(planBase(at('large'), touch('x0'))).toEqual({ kind: 'note', note: 'tooLarge' })
  expect(planBase(at('unreadable'), touch('x0'))).toEqual({ kind: 'note', note: 'unavailable' })
  expect(planBase(undefined, touch('x0'))).toEqual({ kind: 'base', base: 'x0' })
  expect(planBase(undefined, touch(''))).toEqual({ kind: 'base', base: '' })
  expect(planBase(undefined, touch(null))).toEqual({ kind: 'note', note: 'unavailable' })
  expect(planBase(undefined, undefined)).toEqual({ kind: 'note', note: 'unavailable' })
})

test('2 回目以降の書き換えの直前に取った記録は使わない', () => {
  const late = { state: 'text' as const, toolUseId: 't2' }
  expect(planBase(late, { base: null, later: ['t2'] })).toEqual({ kind: 'note', note: 'unavailable' })
  expect(planBase(late, { base: '', later: ['t2'] })).toEqual({ kind: 'base', base: '' })
  expect(planBase(late, { base: null, later: ['t3'] })).toEqual({ kind: 'record' })
})

test('拒否・エラー・保留の結果は書き換えなしとし、それ以外は結果のパスを使う', () => {
  expect(writtenPath({ result: { filePath: '/private/tmp/a' } }, '/tmp/a')).toBe('/private/tmp/a')
  expect(writtenPath({ result: {} }, '/tmp/a')).toBe('/tmp/a')
  expect(writtenPath({ deny: 'no' }, '/tmp/a')).toBe(null)
  expect(writtenPath({ result: 'failed', isError: true }, '/tmp/a')).toBe(null)
  expect(writtenPath({ result: { filePath: '/tmp/a', staged: true } }, '/tmp/a')).toBe(null)
})

test('消すのは保存期間を過ぎたセッションのフォルダだけで、いまのセッションと名前の形が違うものは残す', () => {
  const now = KEEP_MS * 2
  const dirs = [
    { name: 'old', mtimeMs: 0 },
    { name: 'recent', mtimeMs: now - 1000 },
    { name: 'current', mtimeMs: 0 },
    { name: '..', mtimeMs: 0 },
    { name: '.hidden', mtimeMs: 0 },
  ]
  expect(staleSessions(dirs, now, 'current')).toEqual(['old'])
})
