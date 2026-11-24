import { expect, test } from 'claude-code/testing'

import { MESSAGES } from './locale'
import { gitFiles, hunkPathspecs } from './overview'

const entries = [
  { path: 'a.ts', added: 1, removed: 1, isBinary: false },
  { path: 'new.ts', oldPath: 'old.ts', added: 2, removed: 0, isBinary: false },
  { path: 'moved.ts', oldPath: 'src/moved.ts', added: 0, removed: 0, isBinary: false },
  { path: 'mode.sh', added: 0, removed: 0, isBinary: false },
  { path: 'image.png', added: 0, removed: 0, isBinary: true },
  { path: 'b.ts', added: 3, removed: 0, isBinary: false },
]
const hunk = { oldStart: 1, newStart: 1, lines: ['-x', '+y'] }

test('名前を変えたファイルの中身を読むときは、元の名前も pathspec に入れる', () => {
  expect(hunkPathspecs(entries.slice(0, 2))).toEqual([':(top,literal)a.ts', ':(top,literal)new.ts', ':(top,literal)old.ts'])
})

test('読みたいファイルにだけ中身を入れ、ほかは未読、本文の無いものは理由を付ける', () => {
  const files = gitFiles('/r', entries, new Set(['a.ts', 'new.ts']), [{ path: 'a.ts', hunks: [hunk], isBinary: false }], false, MESSAGES.ja)
  expect(files.map(f => [f.path, f.hunks === null ? null : f.hunks.length, f.note ?? ''])).toEqual([
    ['/r/a.ts', 1, ''],
    ['/r/new.ts', 0, '比較不可'],
    ['/r/moved.ts', 0, '名前の変更のみ'],
    ['/r/mode.sh', 0, '中身の変更なし'],
    ['/r/image.png', 0, 'バイナリ'],
    ['/r/b.ts', null, ''],
  ])
  expect(files[1]!.oldPath).toBe('/r/old.ts')
})

test('出力が上限で切れたときは、最後のファイルと出力に無いファイルを「大きいため省略」にする', () => {
  const parsed = [
    { path: 'a.ts', hunks: [hunk], isBinary: false },
    { path: 'new.ts', hunks: [hunk], isBinary: false },
  ]
  const files = gitFiles('/r', entries, new Set(['a.ts', 'new.ts', 'b.ts']), parsed, true, MESSAGES.ja)
  expect(files.filter(f => f.hunks !== null && f.hunks.length > 0).map(f => f.path)).toEqual(['/r/a.ts'])
  expect(files.find(f => f.path === '/r/new.ts')?.note).toBe('大きいため省略')
  expect(files.find(f => f.path === '/r/b.ts')?.note).toBe('大きいため省略')
})
