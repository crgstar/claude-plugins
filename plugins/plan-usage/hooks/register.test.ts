import type { RenderElement, SessionAuthorization } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// 取得から描画までを register ごと通す。ネットワーク・設定・時計はテストの hook が engine の代わりに答える
const USAGE = JSON.stringify({
  five_hour: { utilization: 12, resets_at: '2026-11-05T05:00:00+00:00' },
  seven_day: { utilization: 3, resets_at: '2026-11-10T00:00:00+00:00' },
})

const reply = (uuid: string, content: { type: string; [field: string]: unknown }[], agentId?: string) => ({
  message: { type: 'assistant' as const, role: 'assistant' as const, content },
  door: 'response' as const,
  origin: { kind: 'model' as const, model: 'claude-opus-5-5' },
  uuid,
  ...(agentId === undefined ? {} : { agentId }),
})

const text = (t: string) => ({ type: 'text', text: t })

const assistantMessage = <S extends 'terminal' | 'desktop' | 'vscode' | 'mobile'>(surface: S, requestId: string) => ({
  plugin: 'plan-usage',
  surface,
  component: 'AssistantMessage' as const,
  requestId,
  props: { text: `reply ${requestId}`, isFirstOfReply: true },
})

const startSession = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], auth: SessionAuthorization = { kind: 'bearer', handle: 'h' }) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-05T03:00:00Z') })
  mock.store(on)
  mock.env(on, {})
  mock.session(on)
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.authorize', () => ({ value: auth }))
  on('http.fetch', () => ({ value: { ok: true, status: 200, text: USAGE, headers: {} } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // engine が描く応答の本文の代わり
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => h($.ui.resolve(e).Text, {}, e.props.text) as RenderElement)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
}

test('スマホと VS Code では本文を持つ最後の応答にだけボタンが付き、押すと使用量を開閉する', async ($, on) => {
  await startSession($, on)
  await $.session.append(reply('r1', [text('一つ目')]))
  await $.session.append(reply('r2', [text('二つ目')]))
  // 本文の無い行・サブエージェントの行は付け先を動かさない
  await $.session.append(reply('r3', [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]))
  await $.session.append(reply('r4', [text('サブエージェント')], 'a1'))

  for (const surface of ['mobile', 'vscode'] as const) {
    const last = await $.ui.mount(assistantMessage(surface, 'r2'))
    expect(await last.find({ type: 'Text', text: /reply r2/ })).toBeDefined()
    expect(await last.find({ key: 'usage' })).toBeDefined()
    expect(await last.find({ type: 'Text', text: /Session/ })).toBeUndefined()
    await last.press({ key: 'usage' })
    expect(await last.find({ type: 'Text', text: /Session/ })).toBeDefined()
    await last.press({ key: 'usage' })
    expect(await last.find({ type: 'Text', text: /Session/ })).toBeUndefined()
    await last.unmount()

    const earlier = await $.ui.mount(assistantMessage(surface, 'r1'))
    expect(await earlier.find({ type: 'Text', text: /reply r1/ })).toBeDefined()
    expect(await earlier.find({ key: 'usage' })).toBeUndefined()
    await earlier.unmount()
  }
})

test('新しい応答が来ると、開いたままボタンがそちらへ移る', async ($, on) => {
  await startSession($, on)
  await $.session.append(reply('r1', [text('一つ目')]))
  const first = await $.ui.mount(assistantMessage('mobile', 'r1'))
  await first.press({ key: 'usage' })

  await $.session.append(reply('r2', [text('二つ目')]))
  expect(await first.find({ key: 'usage' })).toBeUndefined()
  await first.unmount()

  const second = await $.ui.mount(assistantMessage('mobile', 'r2'))
  expect(await second.find({ type: 'Text', text: /Session/ })).toBeDefined()
  await second.unmount()
})

test('ターミナルとデスクトップの応答にはボタンを付けない (プロンプト下の右端に出すため)', async ($, on) => {
  await startSession($, on)
  await $.session.append(reply('r1', [text('一つ目')]))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(assistantMessage(surface, 'r1'))
    expect(await ui.find({ type: 'Text', text: /reply r1/ })).toBeDefined()
    expect(await ui.find({ key: 'usage' })).toBeUndefined()
    await ui.unmount()
  }
})

test('API キー等で使用量が無いときは、スマホと VS Code でもボタンを付けない', async ($, on) => {
  await startSession($, on, { kind: 'api-key', handle: 'h' })
  await $.session.append(reply('r1', [text('一つ目')]))

  for (const surface of ['mobile', 'vscode'] as const) {
    const ui = await $.ui.mount(assistantMessage(surface, 'r1'))
    expect(await ui.find({ type: 'Text', text: /reply r1/ })).toBeDefined()
    expect(await ui.find({ key: 'usage' })).toBeUndefined()
    await ui.unmount()
  }
})
