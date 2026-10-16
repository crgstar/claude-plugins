import { expect, test } from 'claude-code/testing'
import type { Locale } from './locale.ts'
import { drawSummary } from './summary.ts'
import type { UsageWindow } from './usage.ts'

const NOW = new Date(2026, 9, 13, 15, 0).getTime()
const WINDOWS = [
  { title: 'Current session', short: 'Session', percent: 12, resetsAt: new Date(2026, 9, 13, 17, 9).toISOString(), periodMs: 5 * 3_600_000 },
  { title: 'Current week (all models)', short: 'Week', percent: 85, resetsAt: new Date(2026, 9, 20, 7, 0).toISOString(), periodMs: 7 * 86_400_000 },
  { title: 'Current week (Fable)', short: 'Fable', percent: 0, resetsAt: new Date(2026, 9, 20, 7, 0).toISOString(), periodMs: 7 * 86_400_000 },
]

// 取得はネットワークを使うのでテストでは走らせない。plugin の hook は取得前は next に流すので、
// その下に固定データで描く hook を置けば、こちらの木がエンジンの検証にかかる
type Case = { name: string; locale: Locale; windows: UsageWindow[]; error: string | undefined; modes?: string; expected: RegExp[] }
const cases: Case[] = [
  { name: '3 枠そろって取れた', locale: 'ja', windows: WINDOWS, error: undefined, expected: [/Session/, /Week/, /Fable/, /10\/20\(火\)/] },
  { name: '更新に失敗した (直前の値は残す)', locale: 'ja', windows: WINDOWS, error: 'HTTP 500', expected: [/Session/, /更新失敗: HTTP 500/] },
  { name: '一度も取れていない', locale: 'ja', windows: [], error: 'HTTP 401', expected: [/取得失敗: HTTP 401/] },
  { name: '元のモード表示がある', locale: 'ja', windows: WINDOWS, error: undefined, modes: 'focus', expected: [/focus/, /Session/] },
  { name: '英語で 3 枠そろって取れた', locale: 'en', windows: WINDOWS, error: undefined, expected: [/Session/, /Oct 20 \(Tue\)/] },
  { name: '英語で更新に失敗した', locale: 'en', windows: WINDOWS, error: 'HTTP 500', expected: [/Failed to update: HTTP 500/] },
  { name: '英語で一度も取れていない', locale: 'en', windows: [], error: 'HTTP 401', expected: [/Failed to fetch: HTTP 401/] },
]

for (const c of cases) {
  test(`drawSummary の木は terminal の検証を通る (${c.name})`, async ($, on) => {
    on('ui.render', { component: 'SessionMode' }, ($, e) =>
      drawSummary($.ui.resolve(e), { windows: c.windows, error: c.error, nowMs: NOW, locale: c.locale, modes: c.modes }),
    )
    const ui = await $.ui.mount({ plugin: 'plan-usage', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
    await expect(ui.drawn()).resolves.toMatchObject({ type: 'Box' })
    for (const text of c.expected) expect(await ui.find({ type: 'Text', text })).toBeDefined()
    await ui.unmount()
  })
}
