import { expect, test } from 'claude-code/testing'
import { barCells, elapsedRatio, formatResetShort, paceLevel, parseUsage, summaryRows } from './usage.ts'

// 実際の /api/oauth/usage 応答から使う部分だけ残したもの
const H = 5 * 3_600_000
const D = 7 * 86_400_000

const REAL = JSON.stringify({
  five_hour: { utilization: 12.0, resets_at: '2026-10-13T08:09:59.572742+00:00' },
  seven_day: { utilization: 3.0, resets_at: '2026-10-19T22:00:00.572760+00:00' },
  seven_day_sonnet: null,
  limits: [
    { kind: 'session', group: 'session', percent: 12, resets_at: '2026-10-13T08:09:59.572742+00:00', scope: null },
    { kind: 'weekly_all', group: 'weekly', percent: 3, resets_at: '2026-10-19T22:00:00.572760+00:00', scope: null },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 0,
      resets_at: '2026-10-19T22:00:00+00:00',
      scope: { model: { id: null, display_name: 'Fable' }, surface: null },
    },
  ],
})

test('parseUsage は limits[] を公式と同じ見出しの 3 本にする', () => {
  expect(parseUsage(REAL)).toEqual([
    { title: 'Current session', short: 'Session', percent: 12, resetsAt: '2026-10-13T08:09:59.572742+00:00', periodMs: H },
    { title: 'Current week (all models)', short: 'Week', percent: 3, resetsAt: '2026-10-19T22:00:00.572760+00:00', periodMs: D },
    { title: 'Current week (Fable)', short: 'Fable', percent: 0, resetsAt: '2026-10-19T22:00:00+00:00', periodMs: D },
  ])
})

test('parseUsage は limits[] が無い応答では five_hour / seven_day から組み立て、小数は切り捨てる', () => {
  const text = JSON.stringify({ five_hour: { utilization: 41.9, resets_at: null }, seven_day: { utilization: 7, resets_at: 'x' } })
  expect(parseUsage(text)).toEqual([
    { title: 'Current session', short: 'Session', percent: 41, resetsAt: undefined, periodMs: H },
    { title: 'Current week (all models)', short: 'Week', percent: 7, resetsAt: 'x', periodMs: D },
  ])
})

test('parseUsage は知らない kind とモデル名の無い scoped を捨てる', () => {
  const text = JSON.stringify({ limits: [{ kind: 'mystery', percent: 5 }, { kind: 'weekly_scoped', percent: 5, scope: null }] })
  expect(parseUsage(text)).toEqual([])
})

test('parseUsage は JSON でない応答に null を返す', () => {
  expect(parseUsage('<html>')).toBe(null)
  expect(parseUsage('null')).toBe(null)
})

test('elapsedRatio は枠の時間のうち過ぎた割合で、リセット時刻が無ければ undefined', () => {
  const reset = new Date(2026, 9, 13, 20, 0)
  const w = { title: '', short: 'Session', percent: 0, resetsAt: reset.toISOString(), periodMs: H }
  expect(Math.round((elapsedRatio(w, reset.getTime() - 3 * 3_600_000) ?? 0) * 100)).toBe(40)
  expect(elapsedRatio(w, reset.getTime() + 1000)).toBe(1)
  expect(elapsedRatio({ ...w, resetsAt: undefined }, 0)).toBe(undefined)
  expect(elapsedRatio({ ...w, resetsAt: 'junk' }, 0)).toBe(undefined)
})

test('paceLevel はペースより 5 ポイント以上先なら warn、95% で over', () => {
  expect(paceLevel(44, 0.4)).toBe('ok')
  expect(paceLevel(45, 0.4)).toBe('warn')
  expect(paceLevel(90, 0.99)).toBe('ok')
  expect(paceLevel(95, 1)).toBe('over')
  expect(paceLevel(60, undefined)).toBe('ok')
})

test('barCells は使用率で塗り、過ぎた割合の位置に目印を重ねる', () => {
  expect(barCells(50, 0.25, 8).join(',')).toBe('fill,fill,markOnFill,fill,track,track,track,track')
  expect(barCells(10, 0.5, 4).join(',')).toBe('fill,track,mark,track')
  // 枠の序盤で目印が先頭に来ても、塗りが消えずに残る (0% と区別できる)
  expect(barCells(5, 0.05, 12)[0]).toBe('markOnFill')
  expect(barCells(0, 0.05, 12)[0]).toBe('mark')
  expect(barCells(0, undefined, 4)).toEqual(['track', 'track', 'track', 'track'])
  expect(barCells(1, undefined, 4)).toEqual(['fill', 'track', 'track', 'track'])
  // 枠の終わりでも目印ははみ出さず末尾に置く
  expect(barCells(100, 1, 3)).toEqual(['fill', 'fill', 'markOnFill'])
})

test('formatResetShort は同じ日なら 24 時間表記の時刻、違う日なら ja は 月/日(曜)、en は Mon D (曜)', () => {
  const now = new Date(2026, 9, 13, 15, 0).getTime()
  expect(formatResetShort(new Date(2026, 9, 13, 17, 9).toISOString(), now, 'ja')).toBe('17:09')
  expect(formatResetShort(new Date(2026, 9, 13, 17, 9).toISOString(), now, 'en')).toBe('17:09')
  expect(formatResetShort(new Date(2026, 9, 20, 7, 0).toISOString(), now, 'ja')).toBe('10/20(火)')
  expect(formatResetShort(new Date(2026, 9, 20, 7, 0).toISOString(), now, 'en')).toBe('Oct 20 (Tue)')
  expect(formatResetShort('junk', now, 'en')).toBe('')
})

test('summaryRows はラベルと使用率の幅を揃える', () => {
  const now = new Date(2026, 9, 13, 15, 0).getTime()
  const rows = summaryRows(
    [
      { title: '', short: 'Session', percent: 12, resetsAt: new Date(2026, 9, 13, 17, 0).toISOString(), periodMs: H },
      { title: '', short: 'Fable', percent: 100, resetsAt: new Date(2026, 9, 20, 7, 0).toISOString(), periodMs: D },
    ],
    now,
    10,
    'ja',
  )
  expect(rows.map((r) => [r.label, r.percent, r.reset, r.level])).toEqual([
    ['Session', ' 12%', '17:00', 'ok'],
    ['Fable  ', '100%', '10/20(火)', 'over'],
  ])
  expect(rows[0]?.cells.length).toBe(10)
})
