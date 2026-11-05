import { expect, test } from 'claude-code/testing'
import { isReplyTextRow, showsUsageButton } from './placement.ts'

test('showsUsageButton はプロンプト下の右端が描かれない画面 (スマホ・VS Code) でだけ真', () => {
  expect(showsUsageButton('mobile')).toBe(true)
  expect(showsUsageButton('vscode')).toBe(true)
  expect(showsUsageButton('terminal')).toBe(false)
  expect(showsUsageButton('desktop')).toBe(false)
})

test('isReplyTextRow は本文を持つメインの応答の行を拾う', () => {
  expect(isReplyTextRow({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: '終わりました' }] } })).toBe(true)
})

test('isReplyTextRow は思考やツール呼び出しと並んでいても本文があれば拾う', () => {
  const content = [
    { type: 'thinking' as const, thinking: '…', signature: 's' },
    { type: 'text' as const, text: '確認します' },
    { type: 'tool_use' as const, id: 't1', name: 'Bash', input: {} },
  ]
  expect(isReplyTextRow({ message: { type: 'assistant', role: 'assistant', content } })).toBe(true)
})

test('isReplyTextRow は本文として描かれない応答の行を拾わない', () => {
  expect(isReplyTextRow({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'thinking', thinking: '…', signature: 's' }] } })).toBe(false)
  expect(isReplyTextRow({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } })).toBe(false)
  expect(isReplyTextRow({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: ' \n' }] } })).toBe(false)
})

test('isReplyTextRow はサブエージェントの応答とユーザーの行を拾わない', () => {
  expect(isReplyTextRow({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: '調べました' }] }, agentId: 'a1' })).toBe(false)
  expect(isReplyTextRow({ message: { type: 'user', role: 'user', content: [{ type: 'text', text: '続けて' }] } })).toBe(false)
})
