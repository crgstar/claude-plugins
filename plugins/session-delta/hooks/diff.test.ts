import { expect, test } from 'claude-code/testing'

import {
  addedHunks,
  countChanges,
  diffSourceOf,
  expandHunks,
  fitHatch,
  HATCH,
  levelLabel,
  planView,
  pressTarget,
  toRows,
  treeCost,
  type Hunk,
} from './diff'
import { MESSAGES } from './locale'

const FILE = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
const HUNK: Hunk = {
  oldStart: 7,
  newStart: 7,
  lines: [' line 7', ' line 8', ' line 9', '-line 10', '+line X', ' line 11', '+added', ' line 12', ' line 13', ' line 14'],
}

const lineRow = (r: ReturnType<typeof toRows>[number]) =>
  r.type === 'gap' ? ['gap', r.skipped] : [r.left?.n ?? null, r.left?.kind ?? null, r.right?.n ?? null, r.right?.kind ?? null]

test('Edit と Write の差分だけを取り出し、差分なし・保留・他のツールは除く', () => {
  const edit = { filePath: '/a.ts', structuredPatch: [HUNK], originalFile: FILE }
  expect(diffSourceOf('Edit', edit)?.filePath).toBe('/a.ts')
  expect(diffSourceOf('Write', { ...edit, originalFile: null })?.originalFile).toBe(null)
  expect(diffSourceOf('Write', { ...edit, structuredPatch: [] })).toBe(null)
  expect(diffSourceOf('Edit', { ...edit, staged: true })).toBe(null)
  expect(diffSourceOf('Bash', edit)).toBe(null)
  expect(diffSourceOf('Edit', { ...edit, structuredPatch: [{ lines: [] }] })).toBe(null)
})

test('追加と削除の行数を数える', () => {
  expect(countChanges([HUNK])).toEqual({ added: 2, removed: 1 })
})

test('削除と追加を同じ行に並べ、前後と末尾に省いた行数を挟む', () => {
  expect(toRows([HUNK], 20).map(lineRow)).toEqual([
    ['gap', 6],
    [7, 'same', 7, 'same'],
    [8, 'same', 8, 'same'],
    [9, 'same', 9, 'same'],
    [10, 'del', 10, 'add'],
    [11, 'same', 11, 'same'],
    [null, null, 12, 'add'],
    [12, 'same', 13, 'same'],
    [13, 'same', 14, 'same'],
    [14, 'same', 15, 'same'],
    ['gap', 6],
  ])
})

test('前後を広げると、変更前のファイルから文脈を足し、行番号もずらす', () => {
  const wide = expandHunks(FILE, [HUNK], 2)!
  expect(wide).toHaveLength(1)
  expect(wide[0]!.oldStart).toBe(5)
  expect(wide[0]!.newStart).toBe(5)
  expect(wide[0]!.lines[0]).toBe(' line 5')
  expect(wide[0]!.lines[wide[0]!.lines.length - 1]).toBe(' line 16')
})

test('ファイル全体まで広げると、先頭から末尾まで省かずに並ぶ', () => {
  const all = expandHunks(FILE, [HUNK], Number.POSITIVE_INFINITY)!
  const rows = toRows(all, 20)
  expect(rows.some(r => r.type === 'gap')).toBe(false)
  expect(lineRow(rows[0]!)).toEqual([1, 'same', 1, 'same'])
  expect(lineRow(rows[rows.length - 1]!)).toEqual([20, 'same', 21, 'same'])
})

test('広げてつながる 2 つのハンクは 1 つにまとめ、間の行を文脈で埋める', () => {
  const a: Hunk = { oldStart: 1, newStart: 1, lines: ['-line 1', '+one', ' line 2'] }
  const b: Hunk = { oldStart: 6, newStart: 6, lines: [' line 6', '-line 7', '+seven'] }
  expect(expandHunks(FILE, [a, b], 1)).toHaveLength(2)
  const merged = expandHunks(FILE, [a, b], 2)!
  expect(merged).toHaveLength(1)
  expect(merged[0]!.lines).toEqual([
    '-line 1', '+one', ' line 2', ' line 3', ' line 4', ' line 5', ' line 6', '-line 7', '+seven', ' line 8', ' line 9',
  ])
})

test('差分が変更前のファイルと合わないときは広げない', () => {
  const stale: Hunk = { ...HUNK, lines: [' other', ...HUNK.lines.slice(1)] }
  expect(expandHunks(FILE, [stale], 2)).toBe(null)
  const view = planView({ filePath: '/a.ts', hunks: [stale], originalFile: FILE }, 2)!
  expect(view.canExpand).toBe(false)
  expect(view.level).toBe(0)
})

test('変更前のファイルが無いときは広げず、末尾の省略も書かない', () => {
  const view = planView({ filePath: '/a.ts', hunks: [HUNK], originalFile: null }, 2)!
  expect(view.canExpand).toBe(false)
  expect(view.rows[view.rows.length - 1]!.type).toBe('line')
})

test('大きすぎる段階は下げて描き、どの段階でも収まらなければ描かない', () => {
  const big = Array.from({ length: 3000 }, (_, i) => `const value${i} = ${'x'.repeat(30)}`).join('\n') + '\n'
  const first = big.split('\n')[0]!
  const hunk: Hunk = { oldStart: 1, newStart: 1, lines: [`-${first}`, '+changed'] }
  const clamped = planView({ filePath: '/big.ts', hunks: [hunk], originalFile: big }, 2)!
  expect(clamped.wanted).toBe(2)
  expect(clamped.level).toBe(1)

  const huge: Hunk = { oldStart: 1, newStart: 1, lines: Array.from({ length: 3000 }, (_, i) => `+${'y'.repeat(40)}${i}`) }
  expect(planView({ filePath: '/new.ts', hunks: [huge], originalFile: null }, 0)).toBe(null)
})

test('ボタンは押したあとの段階を書き、下げて描いたときは最初に戻す', () => {
  expect(levelLabel(pressTarget({ level: 0, wanted: 0 }), MESSAGES.ja)).toBe('前後 +10 行')
  expect(levelLabel(pressTarget({ level: 1, wanted: 1 }), MESSAGES.ja)).toBe('ファイル全体')
  expect(levelLabel(pressTarget({ level: 2, wanted: 2 }), MESSAGES.ja)).toBe('変更箇所のみ')
  expect(pressTarget({ level: 1, wanted: 2 })).toBe(0)
})

test('片側が空の行の斜線は、上限に収まるときだけ入れ、収まらなければ斜線だけを省く', () => {
  const added = (n: number): Hunk => ({ oldStart: 0, newStart: 1, lines: Array.from({ length: n }, (_, i) => `+${'y'.repeat(40)}${i}`) })
  expect(fitHatch(toRows([added(10)]), '/new.ts')).toEqual({ hatch: true })
  expect(fitHatch(toRows([added(500)]), '/new.ts')).toEqual({ hatch: false })
  expect(fitHatch(toRows([added(3000)]), '/new.ts')).toBe(null)
  expect(planView({ filePath: '/new.ts', hunks: [added(10)], originalFile: null }, 0)!.hatch).toBe(true)
  expect(HATCH.startsWith('╱')).toBe(true)
})

test('新規ファイルの中身は末尾の改行で空の行を足さずに追加のハンクにし、空のファイルはハンクなし', () => {
  expect(addedHunks('a\nb\n')).toEqual([{ oldStart: 0, newStart: 1, lines: ['+a', '+b'] }])
  expect(addedHunks('a')).toEqual([{ oldStart: 0, newStart: 1, lines: ['+a'] }])
  expect(addedHunks('')).toEqual([])
})

test('CRLF のファイルで前後を広げても、足した文脈の行に \\r を残さない', () => {
  const original = ['a', 'b', 'c', 'd', 'e', 'f'].map(l => `${l}\r\n`).join('')
  const hunks = expandHunks(original, [
    { oldStart: 2, newStart: 2, lines: ['-b', '+B'] },
    { oldStart: 4, newStart: 4, lines: ['-d', '+D'] },
  ], 1)!
  expect(hunks.map(h => h.lines)).toEqual([[' a', '-b', '+B', ' c', '-d', '+D', ' e']])
})

test('変わった部分ごとに塗る色の案では、削除と追加が対になる行にだけ、1 列表示の 2 行分のノードを見積もる', () => {
  const pair = toRows([{ oldStart: 1, newStart: 1, lines: ['-x = a;', '+x = b;'] }])
  const added = toRows([{ oldStart: 0, newStart: 1, lines: ['+y'] }])
  const base = treeCost([], '/a.ts').nodes
  expect(treeCost(pair, '/a.ts', { word: true }).nodes - base).toBeGreaterThanOrEqual(24)
  expect(treeCost(added, '/a.ts', { word: true })).toEqual(treeCost(added, '/a.ts'))
})

test('CRLF のファイルの差分は、変わった行にも文脈の行にも \\r を残さずに並べる', () => {
  const rows = toRows([{ oldStart: 1, newStart: 1, lines: [' a\r', '-b\r', '+B\r'] }])
  expect(rows.flatMap(r => (r.type === 'line' ? [r.left?.text, r.right?.text] : []))).toEqual(['a', 'a', 'b', 'B'])
})
