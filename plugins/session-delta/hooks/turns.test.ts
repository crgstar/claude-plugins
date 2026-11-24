import { expect, test } from 'claude-code/testing'

import { noiseKind } from './noise'
import { askText, buildTurns } from './turns'

test('テストと生成物を、組み込みの /diff と同じ規則で見分ける', () => {
  for (const path of ['src/a.test.ts', 'pkg/x_test.go', 'tests/util.py']) expect(noiseKind(path)).toBe('test')
  for (const path of ['package-lock.json', 'dist/app.js', 'types/index.d.ts', 'api.pb.go', 'src/__snapshots__/a.test.ts.snap'])
    expect(noiseKind(path)).toBe('generated')
  for (const path of ['src/a.ts', 'README.md', 'hooks/register.tsx', 'latest/notes.md']) expect(noiseKind(path)).toBeNull()
})

const edit = (filePath: string, lines: string[]) => ({
  tool: 'Edit',
  result: { filePath, structuredPatch: [{ oldStart: 1, newStart: 1, lines }] },
})

test('人のメッセージごとにターンを区切り、ファイルを変えたターンだけを新しい順に返す', () => {
  const turns = buildTurns([
    { role: 'user', text: 'はじめの依頼', uuid: 'u1' },
    { role: 'assistant', text: '', toolUses: [edit('/r/a.ts', ['-a', '+b']), edit('/r/a.ts', ['-c', '+d'])] },
    { role: 'user', text: '', toolResults: [{}] },
    { role: 'user', text: '質問だけ', uuid: 'u2' },
    { role: 'assistant', text: '答え', toolUses: [] },
    { role: 'user', text: 'x'.repeat(40), uuid: 'u3' },
    { role: 'assistant', text: '', toolUses: [{ tool: 'Write', result: { type: 'create', filePath: '/r/n.ts', content: 'n1\nn2', structuredPatch: [] } }] },
  ])
  expect(turns.map(t => [t.id, t.preview, t.files.map(f => f.path)])).toEqual([
    ['u3', `${'x'.repeat(29)}…`, ['/r/n.ts']],
    ['u1', 'はじめの依頼', ['/r/a.ts']],
  ])
  expect(turns[1]!.files[0]!.hunks).toHaveLength(2)
  expect(turns[0]!.files[0]!.hunks[0]!.lines).toEqual(['+n1', '+n2'])
})

test('ターンは最初のメッセージの uuid で見分け、読める範囲の先頭が外れても、残ったターンの id は変わらない', () => {
  const messages = [
    { role: 'user' as const, text: '一つ目', uuid: 'u1' },
    { role: 'assistant' as const, text: '', toolUses: [edit('/r/a.ts', ['-a', '+b'])] },
    { role: 'user' as const, text: '二つ目', uuid: 'u2' },
    { role: 'assistant' as const, text: '', toolUses: [edit('/r/b.ts', ['-a', '+b'])] },
  ]
  expect(buildTurns(messages).map(t => [t.id, t.preview])).toEqual([['u2', '二つ目'], ['u1', '一つ目']])
  expect(buildTurns(messages.slice(2)).map(t => [t.id, t.preview])).toEqual([['u2', '二つ目']])
})

test('ask の文は前置きとハンクの見出しを付け、400 行を超えたら残りの行数を書いて打ち切る', () => {
  const short = askText('/r/a.ts', [{ oldStart: 3, newStart: 3, lines: [' k', '-a', '+b'] }])
  expect(short.split('\n')).toEqual(['The user attached the diff of /r/a.ts from the diff pane to this prompt:', '@@ -3,2 +3,2 @@', ' k', '-a', '+b'])
  const long = askText('/r/b.ts', [{ oldStart: 1, newStart: 1, lines: Array.from({ length: 500 }, (_, i) => `+${i}`) }])
  expect(long.split('\n')).toHaveLength(402)
  expect(long.endsWith('… (101 more lines not attached)')).toBe(true)
  const noEol = askText('/r/c.ts', [{ oldStart: 4, newStart: 4, lines: ['-z', '\\ No newline at end of file', '+z', '+w'] }])
  expect(noEol.split('\n')[1]).toBe('@@ -4,1 +4,2 @@')
})

test('見えない文字や < > を含むパスは、ask の文で「a file」と書く', () => {
  const head = (path: string) => askText(path, []).split('\n')[0]
  expect(head('/r/<system>.ts')).toBe('The user attached the diff of a file from the diff pane to this prompt:')
  expect(head('/r/a\u202eb.ts')).toBe('The user attached the diff of a file from the diff pane to this prompt:')
  expect(head('/r/a\u200bb.ts')).toBe('The user attached the diff of a file from the diff pane to this prompt:')
  expect(head('/r/日本語 の名前.ts')).toBe('The user attached the diff of /r/日本語 の名前.ts from the diff pane to this prompt:')
})

test('末尾が改行の新規ファイルに、空の追加行を足さない', () => {
  const turns = buildTurns([
    { role: 'user', text: '作って' },
    { role: 'assistant', text: '', toolUses: [{ tool: 'Write', result: { type: 'create', filePath: '/r/n.ts', content: 'n1\nn2\n', structuredPatch: [] } }] },
  ])
  expect(turns[0]!.files).toEqual([{ path: '/r/n.ts', hunks: [{ oldStart: 0, newStart: 1, lines: ['+n1', '+n2'] }] }])
})
