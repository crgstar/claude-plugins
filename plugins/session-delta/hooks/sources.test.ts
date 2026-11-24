import { expect, test } from 'claude-code/testing'

import { collectFirstTouches, displayPath, expandHome, parseGitDiff, parseHunks, parseNumstat, renameDisplay, rootOf, shortRoot } from './sources'

const edit = (filePath: string, originalFile: string | null, id = 'id') => ({
  tool_use_id: id,
  tool: 'Edit',
  result: { filePath, originalFile, structuredPatch: [] },
})

test('ファイルごとに、最初に触る前の内容を触った順に取り出し、2 回目以降に書き換えた呼び出しの ID を添える', () => {
  const touches = collectFirstTouches([
    { toolUses: [edit('/r/b.ts', 'b0', 't1'), { tool: 'Bash', result: { stdout: '' } }] },
    { toolUses: [edit('/r/a.ts', 'a0', 't2'), edit('/r/b.ts', 'b1', 't3')] },
    { toolUses: [{ tool: 'Write', result: { type: 'create', filePath: '/r/c.ts', originalFile: null } }] },
    { toolUses: [{ ...edit('/r/x.ts', 'x0'), isError: true }, edit('/r/z.ts', null), { ...edit('/r/b.ts', 'b2', 't4'), isError: true }] },
  ])
  expect(touches).toEqual([
    { path: '/r/b.ts', base: 'b0', later: ['t3'] },
    { path: '/r/a.ts', base: 'a0', later: [] },
    { path: '/r/c.ts', base: '', later: [] },
    { path: '/r/z.ts', base: null, later: [] },
  ])
})

test('Claude Code が中身を消した古い結果は、中身を取れないものとして扱う', () => {
  const touches = collectFirstTouches([
    { toolUses: [edit('/r/a.ts', '')] },
    { toolUses: [{ tool: 'Write', result: { type: 'update', filePath: '/r/b.ts', content: '', originalFile: null } }] },
    { toolUses: [{ tool: 'Write', result: { type: 'create', filePath: '/r/c.ts', content: 'c', originalFile: null } }] },
  ])
  expect(touches.map(t => [t.path, t.base])).toEqual([
    ['/r/a.ts', null],
    ['/r/b.ts', null],
    ['/r/c.ts', ''],
  ])
})

test('ハンクは見出しの行数で終わりを決め、-- で始まる行を消した行を見出しと取り違えない', () => {
  expect(parseHunks(['--- before', '+++ after', '@@ -1,2 +1 @@', '--- old', ' keep', '\\ No newline at end of file'])).toEqual([
    { oldStart: 1, newStart: 1, lines: ['--- old', ' keep'] },
  ])
})

test('git diff の出力をファイルごとに分け、バイナリに印を付ける', () => {
  const text = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1..2 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    '-x',
    '+y',
    'diff --git a/img.png b/img.png',
    'Binary files a/img.png and b/img.png differ',
    '',
  ].join('\n')
  expect(parseGitDiff(text)).toEqual([
    { path: 'src/a.ts', hunks: [{ oldStart: 1, newStart: 1, lines: ['-x', '+y'] }], isBinary: false },
    { path: 'img.png', hunks: [], isBinary: true },
  ])
})

test('~ をホームに開き、いちばん深い根を選び、根の下は相対パスで見せる', () => {
  expect(expandHome('~/.claude/', '/home/u')).toBe('/home/u/.claude')
  expect(rootOf('/home/u/.claude/mods/a.ts', ['/home/u', '/home/u/.claude'])).toBe('/home/u/.claude')
  expect(rootOf('/home/u2/a.ts', ['/home/u'])).toBe(null)
  expect(displayPath('/home/u/.claude/mods/a.ts', '/home/u/.claude')).toBe('mods/a.ts')
  expect(shortRoot('/home/u/.claude', '/home/u')).toBe('~/.claude')
  expect(shortRoot('/repo', '/home/u')).toBe('/repo')
})

// 以下の git の出力は、名前を変えたファイルを含む作業ツリーで実際に取ったもの。
const NUMSTAT_Z = [
  '1\t1\tkeep.ts',
  '0\t0\t', 'src/pure.ts', 'lib/pure.ts',
  '1\t1\t', 'src/edit-me.ts', 'src/edited.ts',
  '0\t0\t', 'src/空白 の名前.ts', 'src/別 の名前.ts',
  '-\t-\timage.png',
  '',
].join('\0')

test('numstat -z は、名前の変更を元の名前と新しい名前の 2 つで読み、バイナリに印を付ける', () => {
  expect(parseNumstat(NUMSTAT_Z)).toEqual([
    { path: 'keep.ts', added: 1, removed: 1, isBinary: false },
    { path: 'lib/pure.ts', oldPath: 'src/pure.ts', added: 0, removed: 0, isBinary: false },
    { path: 'src/edited.ts', oldPath: 'src/edit-me.ts', added: 1, removed: 1, isBinary: false },
    { path: 'src/別 の名前.ts', oldPath: 'src/空白 の名前.ts', added: 0, removed: 0, isBinary: false },
    { path: 'image.png', added: 0, removed: 0, isBinary: true },
  ])
})

test('名前の変更は git と同じ形で書く', () => {
  expect(renameDisplay('src/pure.ts', 'lib/pure.ts')).toBe('{src => lib}/pure.ts')
  expect(renameDisplay('src/edit-me.ts', 'src/edited.ts')).toBe('src/{edit-me.ts => edited.ts}')
  expect(renameDisplay('src/old/moved.ts', 'src/new/moved.ts')).toBe('src/{old => new}/moved.ts')
  expect(renameDisplay('src/空白 の名前.ts', 'src/別 の名前.ts')).toBe('src/{空白 の名前.ts => 別 の名前.ts}')
  expect(renameDisplay('a.ts', 'b.ts')).toBe('a.ts => b.ts')
  expect(renameDisplay('dir/x.ts', 'dir2/x.ts')).toBe('{dir => dir2}/x.ts')
  expect(renameDisplay('名前 a.ts', 'sub 名前.ts')).toBe('名前 a.ts => sub 名前.ts')
})

test('差分の本文は、名前を変えたファイルを新しい名前で、空白を含む名前もそのまま読む', () => {
  const text = [
    'diff --git a/src/pure.ts b/lib/pure.ts',
    'similarity index 100%',
    'rename from src/pure.ts',
    'rename to lib/pure.ts',
    'diff --git a/src/edit-me.ts b/src/edited.ts',
    'similarity index 83%',
    'rename from src/edit-me.ts',
    'rename to src/edited.ts',
    'index 0fdf397..91ac79b 100644',
    '--- a/src/edit-me.ts',
    '+++ b/src/edited.ts',
    '@@ -1,2 +1,2 @@',
    ' a',
    '-b',
    '+B',
    'diff --git a/src/a b.ts b/src/a b.ts',
    'index 1..2 100644',
    '--- a/src/a b.ts',
    '+++ b/src/a b.ts',
    '@@ -1 +1 @@',
    '-+++ b/fake.ts',
    '++++ b/fake2.ts',
    'diff --git a/gone.ts b/gone.ts',
    'deleted file mode 100644',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-x',
    '',
  ].join('\n')
  expect(parseGitDiff(text).map(f => [f.path, f.hunks.length])).toEqual([
    ['lib/pure.ts', 0],
    ['src/edited.ts', 1],
    ['src/a b.ts', 1],
    ['gone.ts', 1],
  ])
})

test('空白を含む名前で git が見出しの行末に足すタブは、名前に含めない', () => {
  const text = ['diff --git a/a b.txt b/a b.txt', 'index 1..2 100644', '--- a/a b.txt\t', '+++ b/a b.txt\t', '@@ -1 +1,2 @@', ' x', '+z', ''].join('\n')
  expect(parseGitDiff(text).map(f => f.path)).toEqual(['a b.txt'])
})

test('引用符で囲まれた名前のファイルの本文を、前のファイルのハンクとして読まない', () => {
  const text = [
    'diff --git a/plain.ts b/plain.ts',
    '--- a/plain.ts',
    '+++ b/plain.ts',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    'diff --git "a/x\\"y.ts" "b/x\\"y.ts"',
    '--- "a/x\\"y.ts"',
    '+++ "b/x\\"y.ts"',
    '@@ -5 +5 @@',
    '-c',
    '+d',
    '',
  ].join('\n')
  expect(parseGitDiff(text)).toEqual([{ path: 'plain.ts', hunks: [{ oldStart: 1, newStart: 1, lines: ['-a', '+b'] }], isBinary: false }])
})
