import { expect, test } from 'claude-code/testing'

import { hunkGaps, pairRows, toUnifiedRows } from './pane'

test('1 列の行は、削除に変更前の番号、追加に変更後の番号を振る', () => {
  const rows = toUnifiedRows([{ oldStart: 5, newStart: 7, lines: [' a', '-b', '+c', ' d'] }])
  expect(rows.map(r => [r.old, r.new, r.kind])).toEqual([
    [5, 7, 'same'],
    [6, null, 'del'],
    [null, 8, 'add'],
    [7, 9, 'same'],
  ])
})

test('続く削除と追加を前から対にし、余った行は相手なし', () => {
  const rows = toUnifiedRows([{ oldStart: 1, newStart: 1, lines: [' a', '-b', '-c', '+B', ' d', '+e'] }])
  expect(pairRows(rows)).toEqual([null, 3, null, 1, null, null])
})

test('各ハンクの前に省いた行数を数える', () => {
  expect(hunkGaps([
    { oldStart: 3, newStart: 3, lines: ['-a', '+b'] },
    { oldStart: 10, newStart: 10, lines: [' x', '-c', '+d'] },
    { oldStart: 12, newStart: 12, lines: ['-e'] },
  ])).toEqual([2, 6, 0])
})


test('「\\ No newline at end of file」の行は 1 列の行にせず、後ろの行の番号もずらさない', () => {
  const rows = toUnifiedRows([{ oldStart: 3, newStart: 3, lines: ['-last', '\\ No newline at end of file', '+last', '+new'] }])
  expect(rows.map(r => [r.old, r.new, r.kind, r.text])).toEqual([
    [3, null, 'del', 'last'],
    [null, 3, 'add', 'last'],
    [null, 4, 'add', 'new'],
  ])
  expect(pairRows(rows)).toEqual([1, 0, null])
})

test('1 列表示の行にも、CRLF の行末の \\r を残さない', () => {
  expect(toUnifiedRows([{ oldStart: 1, newStart: 1, lines: [' a\r', '-b\r', '+B\r'] }]).map(r => r.text)).toEqual(['a', 'b', 'B'])
})
