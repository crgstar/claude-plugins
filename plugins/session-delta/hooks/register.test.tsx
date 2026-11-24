import type { On, SessionMessage } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { MESSAGES } from './locale'
import { HATCH_COLOR, styleSpec } from './look'
import { touchKey } from './touches'
import { commandIntent, countLabel, listCost, pageOf, pageSpan, rangeLabel, rangeOf, rangeOptions, rangeValue, shownFiles, sortAsked, toggled, turnPages } from './register'

const FILE = 'const a = 1\nconst b = 2\nexport { a }\n'

const EDIT_RESULT = {
  plugin: 'session-delta',
  component: 'ToolResult',
  requestId: 'toolu_1',
  props: {
    tool_use_id: 'toolu_1',
    tool: 'Edit',
    isErrored: false,
    output: {
      filePath: '/repo/a.ts',
      oldString: 'const b = 2',
      newString: 'const b = 3',
      originalFile: FILE,
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          lines: [' const a = 1', '-const b = 2', '+const b = 3', ' export { a }'],
        },
      ],
      userModified: false,
      replaceAll: false,
    },
  },
} as const

const engine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const japanese = (on: On) => on('settings.read', () => ({ value: { language: 'Japanese' } }))

const RUN ={ origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

const labelOf = (el: { text: string; props: Record<string, unknown> } | undefined) =>
  el === undefined ? undefined : el.text !== '' ? el.text : String(el.props.label)

const stubStore = (on: On, saved?: string) => {
  on('store.get', () => ({ value: saved }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'session-delta' } }))
}

test('引数なしは変更一覧、on と off は左右表示の向き、colors は色の案、ほかは受け付けない', () => {
  expect(commandIntent('')).toEqual({ open: 'overview' })
  expect(commandIntent(' ')).toEqual({ open: 'overview' })
  expect(commandIntent('on')).toEqual({ mode: 'split' })
  expect(commandIntent('off')).toEqual({ mode: 'original' })
  expect(commandIntent('colors')).toEqual({ open: 'look' })
  expect(commandIntent('session')).toBe(null)
  expect(commandIntent('all')).toBe(null)
})

test('Edit の結果を左右に並べ、上の行は増減と、前後を広げるボタンと、並べ方のボタンだけ', async ($, on) => {
  engine(on)
  japanese(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...EDIT_RESULT, surface })
    expect((await ui.findAll({ type: 'Code' })).length).toBe(6)
    expect(await ui.find({ type: 'Text', text: '+1' })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['context', 'layout'])
    expect(labelOf(await ui.find({ key: 'layout' }))).toBe('1 列')
    expect(labelOf(await ui.find({ key: 'context' }))).toBe('前後 +10 行')
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeUndefined()
    await ui.unmount()
  }
})

test('並べ方のボタンで、会話の中の差分をすべて 1 列と左右で切り替え、選んだ並べ方を保存する', async ($, on) => {
  engine(on)
  japanese(on)
  const saved: [string, unknown][] = []
  on('store.set', (_, e) => {
    saved.push([e.key, e.value])
    return { value: undefined }
  })
  const ui = await $.ui.mount({ ...EDIT_RESULT, surface: 'terminal' })
  await ui.press({ key: 'layout' })
  expect(labelOf(await ui.find({ key: 'layout' }))).toBe('左右')
  expect((await ui.findAll({ type: 'Code' })).length).toBe(4)
  expect((await ui.findAll({ type: 'Text', text: /^[-+] $/ })).map(t => t.text)).toEqual(['- ', '+ '])
  expect(saved).toEqual([['chatLayout', 'unified']])
  const other = { ...EDIT_RESULT, requestId: 'toolu_2', props: { ...EDIT_RESULT.props, tool_use_id: 'toolu_2' } }
  const second = await $.ui.mount({ ...other, surface: 'terminal' })
  expect(labelOf(await second.find({ key: 'layout' }))).toBe('左右')
  await second.unmount()
  await ui.press({ key: 'layout' })
  expect((await ui.findAll({ type: 'Code' })).length).toBe(6)
  await ui.unmount()
})

test('左右表示で片側が空の行は、薄い斜線で埋める', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...EDIT_RESULT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^╱+$/ })).toBeUndefined()
  await ui.unmount()
  const added = {
    ...EDIT_RESULT,
    props: {
      ...EDIT_RESULT.props,
      output: {
        ...EDIT_RESULT.props.output,
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [' const a = 1', '+const c = 3'] }],
      },
    },
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    const view = await $.ui.mount({ ...added, surface })
    const hatch = await view.find({ type: 'Text', text: /^╱+$/ })
    expect(hatch?.props.color).toBe(HATCH_COLOR)
    expect(hatch?.props.wrap).toBe(surface === 'terminal' ? undefined : 'clip')
    await view.unmount()
  }
})

test('/session-delta off のあとは標準の表示だけで何も足さず、on で左右表示に戻る', async ($, on) => {
  engine(on)
  stubStore(on)
  await $.command.run({ ...RUN, command: 'session-delta', args: 'off' })
  let ui = await $.ui.mount({ ...EDIT_RESULT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await ui.findAll({ type: 'Code' })).toHaveLength(0)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()

  await $.command.run({ ...RUN, command: 'session-delta', args: 'on' })
  ui = await $.ui.mount({ ...EDIT_RESULT, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Code' })).length).toBe(6)
  await ui.unmount()
})

test('前の session で off にしていれば、始めから元の表示', async ($, on) => {
  engine(on)
  stubStore(on, 'original')
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...EDIT_RESULT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
})

test('設定と環境変数から言語を読めないときは、会話の中の差分を英語で出す', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...EDIT_RESULT, surface: 'terminal' })
  expect(labelOf(await ui.find({ key: 'context' }))).toBe('+10 lines of context')
  await ui.unmount()
})

test('前後を広げるボタンは、その差分の行だけの段階を進める', async ($, on) => {
  engine(on)
  japanese(on)
  const ui = await $.ui.mount({ ...EDIT_RESULT, surface: 'terminal' })
  await ui.press({ key: 'context' })
  expect(labelOf(await ui.find({ key: 'context' }))).toBe('ファイル全体')
  await ui.unmount()

  const other = await $.ui.mount({
    ...EDIT_RESULT,
    requestId: 'toolu_2',
    props: { ...EDIT_RESULT.props, tool_use_id: 'toolu_2' },
    surface: 'terminal',
  })
  expect(labelOf(await other.find({ key: 'context' }))).toBe('前後 +10 行')
  await other.unmount()
})

test('ctrl+o の全文表示・エラー・Edit 以外はエンジンに任せる', async ($, on) => {
  engine(on)
  const cases = [
    { ...EDIT_RESULT.props, isExpanded: true },
    { ...EDIT_RESULT.props, isErrored: true },
    { ...EDIT_RESULT.props, tool: 'Bash', output: { stdout: 'x', stderr: '' } },
  ]
  for (const props of cases) {
    const ui = await $.ui.mount({ ...EDIT_RESULT, props, surface: 'terminal' })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    await ui.unmount()
  }
})

test('描けないほど大きい差分は、一言添えてエンジンの表示を入れる', async ($, on) => {
  engine(on)
  japanese(on)
  const lines = Array.from({ length: 3000 }, (_, i) => `+${'y'.repeat(40)}${i}`)
  const ui = await $.ui.mount({
    ...EDIT_RESULT,
    props: {
      ...EDIT_RESULT.props,
      tool: 'Write',
      output: {
        type: 'update',
        filePath: '/repo/big.ts',
        content: '',
        originalFile: null,
        structuredPatch: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 3000, lines }],
      },
    },
    surface: 'terminal',
  })
  expect(await ui.find({ type: 'Text', text: '差分が大きいため標準表示' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
})

test('ファイルの途中の差分は、前後に省いた行数を挟んで描く', async ($, on) => {
  engine(on)
  japanese(on)
  const file = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const props = {
    ...EDIT_RESULT.props,
    output: {
      ...EDIT_RESULT.props.output,
      originalFile: file,
      structuredPatch: [
        { oldStart: 7, oldLines: 7, newStart: 7, newLines: 7, lines: [' line 7', ' line 8', ' line 9', '-line 10', '+line X', ' line 11', ' line 12', ' line 13'] },
      ],
    },
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...EDIT_RESULT, props, surface })
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Code' })).length).toBe(14)
    expect((await ui.findAll({ type: 'Text', text: /⋯ \d+ 行/ })).map(t => t.text.trim())).toEqual(['⋯ 6 行', '⋯ 7 行'])
    await ui.unmount()
  }
})

const LOOK = {
  plugin: 'session-delta',
  component: 'Pane',
  requestId: 'session-delta-look',
  props: {
    title: '差分の色',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('色の案のパネルは案を並べ、選んだ案を会話の中の差分に使う', async ($, on) => {
  engine(on)
  japanese(on)
  stubStore(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...LOOK, surface })
    expect(await pane.find({ key: 'style-soft' })).toBeUndefined()
    expect(await pane.find({ key: 'style-word' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'ごく淡色の背景' })).toBeDefined()
    expect(await pane.find({ key: 'close' })).toBeUndefined()
    await pane.unmount()
  }

  const pane = await $.ui.mount({ ...LOOK, surface: 'terminal' })
  await pane.press({ key: 'style-word' })
  expect(await pane.find({ key: 'style-word' })).toBeUndefined()
  expect(await pane.find({ key: 'style-soft' })).toBeDefined()
  await pane.unmount()

  const ui = await $.ui.mount({ ...EDIT_RESULT, surface: 'terminal' })
  const sources = (await ui.findAll({ type: 'Code' })).map(c => c.props.source)
  expect(sources).toEqual(['const a = 1', 'const a = 1', 'const b = ', '2', 'const b = ', '3', 'export { a }', 'export { a }'])
  const wordAdd = styleSpec('word').word!.add
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.backgroundColor === wordAdd)).toBe(true)
  await ui.unmount()
})

test('/session-delta colors で色の案のパネルを開く', async ($, on) => {
  stubStore(on)
  let opened = ''
  on('ui.open', (_, e) => {
    opened = e.id
    return { value: { isPlaced: true } }
  })
  await $.command.run({ ...RUN, command: 'session-delta', args: 'colors' })
  expect(opened).toBe('session-delta-look')
})

const BAND = {
  plugin: 'session-delta',
  component: 'AbovePrompt',
  requestId: 'session-delta',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

test('アンケートが帯を使っているあいだは、diff ボタンを出さない', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>survey</Text>
  })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'terminal' })
  expect(await ui.find({ key: 'open-diff' })).toBeUndefined()
  await ui.unmount()
})

const patch = (lines: string[]) => [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines }]
const editUse = (id: string, filePath: string, lines: string[], originalFile = '') => ({
  tool_use_id: id,
  tool: 'Edit',
  input: {},
  result: { filePath, originalFile, structuredPatch: patch(lines) },
})

const OVERVIEW_MESSAGES: SessionMessage[] = [
  { role: 'user', text: '最初の依頼', toolUses: [], uuid: 'u1' },
  {
    role: 'assistant',
    text: '',
    toolUses: [
      editUse('a', '/repo/src/c.ts', ['-c0', '+c1']),
      editUse('b', '/repo/.local/x.html', ['-x0', '+x1'], 'x0\n'),
      editUse('c', '/home/u/.claude/mods/a.ts', ['-a0', '+a1']),
      { tool_use_id: 'd', tool: 'Write', input: {}, result: { type: 'create', filePath: '/tmp/s/b.ts', content: 'b\n', originalFile: null, structuredPatch: [] } },
    ],
  },
  { role: 'user', text: '次の依頼でテストも直す', toolUses: [], uuid: 'u2' },
  { role: 'assistant', text: '', toolUses: [editUse('e', '/repo/src/c.test.ts', ['-t0', '+t1'])] },
]

const GIT_DIFF = [
  'diff --git a/src/c.ts b/src/c.ts', '@@ -1 +1 @@', '-c0', '+c1',
  'diff --git a/src/old.ts b/src/old.ts', '@@ -1 +1 @@', '-o0', '+o1',
  'diff --git a/src/c.test.ts b/src/c.test.ts', '@@ -1 +1 @@', '-t0', '+t1',
  '',
].join('\n')
const GIT_NUMSTAT = ['1\t1\tsrc/c.ts', '1\t1\tsrc/old.ts', '1\t1\tsrc/c.test.ts', ''].join('\0')

/** patched は差分の中身を読んだときの pathspec。 */
type Seen = { opened: string[]; diffedAgainst: string[]; patched: string[][]; before: Map<string, string | undefined>; toasts: string[] }

const PLUGIN_ENV = { CLAUDE_PLUGIN_DATA: '/data', CLAUDE_CODE_SESSION_ID: 's1' }
const RECORD_DIR = '/data/first-touches/s1'
type Records = Record<string, { state: string; id: string; text?: string }>

const recordFiles = (records: Records) =>
  new Map<string, string>(
    Object.entries(records).flatMap(([path, r]) => [
      [`${RECORD_DIR}/${touchKey(path)}.json`, JSON.stringify({ path, state: r.state, toolUseId: r.id })] as const,
      ...(r.text === undefined ? [] : [[`${RECORD_DIR}/${touchKey(path)}.txt`, r.text] as const]),
    ]),
  )

type OverviewStub = {
  gitDiff?: string | (() => string)
  numstat?: string
  slowMs?: number
  records?: Records
  folders?: Record<string, string[]>
  messages?: SessionMessage[]
  /** 会話の記録を読むたびに待つ時間 */
  messagesDelayMs?: () => number
  untracked?: Record<string, string>
  gitFails?: () => boolean
  /** true を返したコマンドは、Claude Code が断ったときと同じく reject する */
  refuses?: (argv: readonly string[]) => boolean
  language?: string
}

const stubOverview = (
  on: On,
  {
    gitDiff = GIT_DIFF,
    numstat = GIT_NUMSTAT,
    slowMs = 0,
    records = { '/home/u/.claude/mods/a.ts': { state: 'text', id: 'c', text: 'a0\n' } },
    folders = {},
    messages = OVERVIEW_MESSAGES,
    messagesDelayMs = () => 0,
    untracked = {},
    gitFails = () => false,
    refuses = () => false,
    language = 'Japanese',
  }: OverviewStub = {},
) => {
  const clock = mock.clock(on)
  const seen: Seen = { opened: [], diffedAgainst: [], patched: [], before: new Map(), toasts: [] }
  stubStore(on)
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.messages', async () => {
    const delay = messagesDelayMs()
    if (delay > 0) await clock.sleep(delay)
    return { value: messages }
  })
  const files = recordFiles(records)
  on('process.hookEnv', () => ({ value: PLUGIN_ENV }))
  on('fs.list', (_, e) => {
    const names = e.path === RECORD_DIR ? [...files.keys()].map(p => p.slice(RECORD_DIR.length + 1)) : (folders[e.path] ?? [])
    return { value: names.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }
  })
  for (const [rel, text] of Object.entries(untracked)) files.set(`/repo/${rel}`, text)
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('session.root', () => ({ value: '/repo' }))
  on('session.usage', () => ({ value: { startedAt: 1000 } as never }))
  on('settings.read', () => ({ value: { permissions: { additionalDirectories: ['~/.claude'] }, language } }))
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.stat', (_, e) => ({ value: { size: 1, kind: 'file', mtimeMs: e.path.includes('old') ? 500 : 2000, isLink: false } }))
  on('ui.open', (_, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('process.run', async (_, e) => {
    const out = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    const argv = e.argv
    if (refuses(argv)) throw new Error('HooksError: refused')
    if (argv.includes('symbolic-ref')) return out('origin/main\n')
    if (argv.includes('merge-base')) return out('abc123\n')
    if (argv.includes('rev-parse')) {
      if (slowMs > 0) await clock.sleep(slowMs)
      return out('/repo\n')
    }
    if (argv[0] === 'git' && argv.includes('diff')) {
      if (gitFails()) throw new Error('timed out')
      if (argv.includes('--numstat')) {
        seen.diffedAgainst.push(argv[argv.indexOf('diff') + 1]!)
        return out(numstat)
      }
      const specs = argv.slice(argv.indexOf('--') + 1)
      seen.patched.push(specs)
      const paths = specs.map(spec => spec.replace(':(top,literal)', ''))
      const blocks = (typeof gitDiff === 'function' ? gitDiff() : gitDiff).split(/(?=^diff --git )/m)
      return out(blocks.filter(b => paths.some(path => b.split('\n')[0]!.endsWith(` b/${path}`))).join(''))
    }
    if (argv.includes('ls-files'))
      return out(argv.includes('--full-name') && argv.includes(':(top)') ? Object.keys(untracked).join('\0') : '')
    if (argv.includes('check-ignore')) return out('/repo/.local/x.html\0')
    seen.before.set(argv.at(-1)!, e.init?.stdin)
    return out('--- before\n+++ after\n@@ -1 +1 @@\n-old\n+new\n', 1)
  })
  return { clock, seen }
}

const OVERVIEW_PANE = { ...LOOK, requestId: 'session-delta-overview', props: { ...LOOK.props, title: '変更一覧' } }

type Found = { key: string | undefined; text: string; props: Record<string, unknown> }
const fileKeys = async (ui: { findAll: (q: { type: string }) => Promise<Found[]> }) =>
  (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('file:'))

type Mounted = { press: (t: { key: string }) => Promise<unknown> }
const pickRange = async (ui: Mounted, value: string) => {
  await ui.press({ key: 'range' })
  await ui.press({ key: `range:${value}` })
}

const openList = async ($: Engine, clock: { settle: () => Promise<void> }) => {
  await $.command.run({ ...RUN, command: 'session-delta', args: '' })
  await clock.settle()
  return $.ui.mount({ ...OVERVIEW_PANE, surface: 'terminal' })
}

test('引数なしの /session-delta は、変更一覧が開いていても閉じずに開いたままにする', async ($, on) => {
  const { clock, seen } = stubOverview(on)
  for (let i = 0; i < 2; i++) {
    const ran = await $.command.run({ ...RUN, command: 'session-delta', args: '' })
    expect(ran.text).toBe('変更一覧を開きました')
    await clock.settle()
  }
  expect(seen.opened).toEqual(['session-delta-overview', 'session-delta-overview'])
})

test('帯の diff ボタンで変更一覧を開き、見出しは場所だけで、作業フォルダの外のファイルにも場所の見出しを立てる', async ($, on) => {
  const { clock, seen } = stubOverview(on)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(labelOf(await band.find({ key: 'open-diff' }))).toBe('diff')
  await band.press({ key: 'open-diff' })
  await band.unmount()
  expect(seen.diffedAgainst).toEqual([])
  await clock.settle()
  expect(seen.opened).toEqual(['session-delta-overview'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...OVERVIEW_PANE, surface })
    for (const title of ['/repo', '~/.claude', '/tmp/s']) expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'その他' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /（/ })).toBeUndefined()
    expect(await fileKeys(ui)).toEqual([
      'file:/repo/src/c.ts',
      'file:/repo/src/c.test.ts',
      'file:/repo/.local/x.html',
      'file:/home/u/.claude/mods/a.ts',
      'file:/tmp/s/b.ts',
    ])
    expect(labelOf(await ui.find({ key: 'earlier' }))).toBe('▸ セッション開始前の変更（1 件）')
    for (const gone of ['close', 'look', 'expand-all', 'collapse-all', 'noise']) expect(await ui.find({ key: gone })).toBeUndefined()
    await ui.unmount()
  }
})

test('language が日本語でなければ、変更一覧を英語で出す', async ($, on) => {
  const { clock } = stubOverview(on, { language: 'English' })
  const ui = await openList($, clock)
  expect(labelOf(await ui.find({ key: 'range' }))).toBe('This session ▾')
  expect(labelOf(await ui.find({ key: 'toggle-all' }))).toBe('Expand all')
  expect(labelOf(await ui.find({ key: 'earlier' }))).toBe('▸ Changed before this session (1)')
  const japaneseText = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u
  const texts = [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(labelOf)
  expect(texts.filter(t => japaneseText.test(t ?? ''))).toEqual([])
  await ui.unmount()
})

test('作業フォルダの外は、目印のあるフォルダを見出しにし、このセッションの一時フォルダは名前で出す', async ($, on) => {
  const { clock } = stubOverview(on, { folders: { '/tmp': ['package.json'] } })
  let scratchpadDir: string | undefined
  on('session.info', () => ({ value: { transcriptPath: '', scratchpadDir } as never }))
  const ui = await openList($, clock)
  expect(await ui.find({ type: 'Text', text: '/tmp' })).toBeDefined()
  expect(labelOf(await ui.find({ key: 'name:/tmp/s/b.ts' }))).toBe('s/b.ts')

  scratchpadDir = '/private/tmp/s'
  await ui.press({ key: 'reload' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '一時フォルダ（このセッション）' })).toBeDefined()
  expect(labelOf(await ui.find({ key: 'name:/tmp/s/b.ts' }))).toBe('b.ts')
  await ui.unmount()
})

test('セッション開始前の変更は、折りたたんだ行を押すと展開する', async ($, on) => {
  const { clock } = stubOverview(on)
  const ui = await openList($, clock)
  expect(await fileKeys(ui)).not.toContain('file:/repo/src/old.ts')
  await ui.press({ key: 'earlier' })
  expect(await fileKeys(ui)).toContain('file:/repo/src/old.ts')
  expect(labelOf(await ui.find({ key: 'earlier' }))).toBe('▾ セッション開始前の変更（1 件）')
  await ui.unmount()
})

test('テスト・生成ファイルにだけ、種類のバッジを付ける', async ($, on) => {
  const { clock } = stubOverview(on)
  const ui = await openList($, clock)
  expect((await ui.findAll({ type: 'Text', text: /^ (テスト|生成) $/ })).map(t => t.text)).toEqual([' テスト '])
  await ui.unmount()
})

test('範囲でブランチ全体を選ぶと分かれた地点と比べ、セッション開始前の行は出さない', async ($, on) => {
  const { clock, seen } = stubOverview(on)
  const ui = await openList($, clock)
  await pickRange(ui, 'branch')
  await clock.settle()
  expect(seen.diffedAgainst.at(-1)).toBe('abc123')
  expect(await ui.find({ key: 'earlier' })).toBeUndefined()
  expect(await fileKeys(ui)).toContain('file:/repo/src/old.ts')
  await ui.unmount()
})

test('範囲でターンを選ぶと、そのターンで Edit / Write したファイルだけを出す', async ($, on) => {
  const { clock } = stubOverview(on)
  const ui = await openList($, clock)
  await pickRange(ui, 't:u1')
  await clock.settle()
  expect(await fileKeys(ui)).toEqual([
    'file:/repo/src/c.ts',
    'file:/repo/.local/x.html',
    'file:/home/u/.claude/mods/a.ts',
    'file:/tmp/s/b.ts',
  ])
  expect(await ui.find({ key: 'earlier' })).toBeUndefined()
  await ui.unmount()
})

test('最初はすべて折りたたみ、ファイルは 1 つずつ展開でき、上のボタンで「すべて展開」と「すべて折りたたむ」を切り替える', async ($, on) => {
  const { clock } = stubOverview(on)
  const ui = await openList($, clock)
  const codes = async () => (await ui.findAll({ type: 'Code' })).length
  expect(await codes()).toBe(0)
  expect(labelOf(await ui.find({ key: 'file:/repo/src/c.ts' }))).toContain('▸')
  expect(labelOf(await ui.find({ key: 'toggle-all' }))).toBe('すべて展開')
  await ui.press({ key: 'name:/repo/src/c.ts' })
  await clock.settle()
  const one = await codes()
  expect(one).toBeGreaterThan(0)
  expect(labelOf(await ui.find({ key: 'file:/repo/src/c.ts' }))).toContain('▾')
  expect(labelOf(await ui.find({ key: 'toggle-all' }))).toBe('すべて折りたたむ')
  await ui.press({ key: 'toggle-all' })
  expect(await codes()).toBe(0)
  await ui.press({ key: 'toggle-all' })
  await clock.settle()
  expect(await codes()).toBeGreaterThan(one)
  await ui.unmount()
})

test('1 列と左右は、上のボタンで押したあとの描き方を書いて切り替える', async ($, on) => {
  const { clock } = stubOverview(on)
  const ui = await openList($, clock)
  const halves = async () => (await ui.findAll({ type: 'Box' })).filter(b => b.props.width === '50%').length
  await ui.press({ key: 'toggle-all' })
  await clock.settle()
  expect(labelOf(await ui.find({ key: 'layout' }))).toBe('左右')
  expect(await halves()).toBe(0)
  await ui.press({ key: 'layout' })
  expect(labelOf(await ui.find({ key: 'layout' }))).toBe('1 列')
  expect(await halves()).toBeGreaterThan(0)
  await ui.unmount()
})

test('比較できないファイルは、行数も ask も出さず「比較不可」とだけ書く', async ($, on) => {
  const { clock } = stubOverview(on, { records: {} })
  const ui = await openList($, clock)
  expect(await ui.find({ key: 'ask:/home/u/.claude/mods/a.ts' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /比較不可/ })).toBeDefined()
  await ui.unmount()
})

test('作業フォルダの git の外は、取っておいた中身と比べ、記録が無ければ会話の記録に残る中身と比べる', async ($, on) => {
  const { clock, seen } = stubOverview(on)
  const ui = await openList($, clock)
  expect(seen.before.get('/home/u/.claude/mods/a.ts')).toBe('a0\n')
  expect(seen.before.get('/repo/.local/x.html')).toBe('x0\n')
  expect(seen.before.get('/tmp/s/b.ts')).toBe('')
  expect(await ui.find({ key: 'ask:/home/u/.claude/mods/a.ts' })).toBeDefined()
  await ui.unmount()
})

test('会話の記録に無い編集も、取っておいた記録があれば一覧に出し、大きくて取らなかったものはそう書く', async ($, on) => {
  const { clock } = stubOverview(on, {
    records: {
      '/home/u/.claude/mods/a.ts': { state: 'text', id: 'c', text: 'a0\n' },
      '/home/u/.claude/mods/sub.ts': { state: 'text', id: 'sub1', text: 's0\n' },
      '/home/u/.claude/mods/big.ts': { state: 'large', id: 'big1' },
    },
  })
  const ui = await openList($, clock)
  expect(await fileKeys(ui)).toContain('file:/home/u/.claude/mods/sub.ts')
  expect(await ui.find({ type: 'Text', text: /大きいため省略/ })).toBeDefined()
  await ui.unmount()
})

test('記録が同じファイルの 2 回目以降の書き換えの直前に取ったものなら使わず、会話の記録で決める', async ($, on) => {
  const { clock, seen } = stubOverview(on, {
    messages: [
      ...OVERVIEW_MESSAGES,
      { role: 'user', text: 'もう一度直す', toolUses: [] },
      {
        role: 'assistant',
        text: '',
        toolUses: [editUse('c2', '/home/u/.claude/mods/a.ts', ['-a1', '+a2']), editUse('d2', '/tmp/s/b.ts', ['-b', '+b2'])],
      },
    ],
    records: {
      '/home/u/.claude/mods/a.ts': { state: 'text', id: 'c2', text: 'a1\n' },
      '/tmp/s/b.ts': { state: 'text', id: 'd2', text: 'b\n' },
    },
  })
  const ui = await openList($, clock)
  expect(seen.before.has('/home/u/.claude/mods/a.ts')).toBe(false)
  expect(await ui.find({ key: 'ask:/home/u/.claude/mods/a.ts' })).toBeUndefined()
  expect(seen.before.get('/tmp/s/b.ts')).toBe('')
  await ui.unmount()
})

const PLAIN_RUN = { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }

test('Edit と Write の直前に、触る前の中身をファイルごとに 1 回だけ取っておき、書き換えなかった呼び出しは記録しない', async ($, on) => {
  const disk = new Map([['/w/a.ts', 'a0\n']])
  on('process.hookEnv', () => ({ value: PLUGIN_ENV }))
  on('fs.exists', (_, e) => ({ value: disk.has(e.path) }))
  on('fs.stat', (_, e) => ({ value: { kind: 'file', size: disk.get(e.path)?.length ?? 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_, e) => ({ value: disk.get(e.path)! }))
  on('fs.write', (_, e) => {
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('tool.call', (_, e) => {
    if (e.tool !== 'Edit' && e.tool !== 'Write') return { result: undefined as never }
    if (e.file_path.endsWith('missing.ts')) return { result: 'File does not exist.' as never, isError: true as const }
    disk.set(e.file_path, e.tool === 'Write' ? e.content : `${e.new_string}\n`)
    return { result: { filePath: e.file_path } as never }
  })
  await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'a0', new_string: 'a1' })
  await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'a1', new_string: 'a2' })
  await $.tool.call({ tool: 'Write', file_path: '/w/new.ts', content: 'n\n' })
  await $.tool.call({ tool: 'Edit', file_path: '/w/missing.ts', old_string: 'x', new_string: 'y' })
  const recorded = (path: string, ext: 'json' | 'txt') => disk.get(`${RECORD_DIR}/${touchKey(path)}.${ext}`)
  expect(disk.get('/w/a.ts')).toBe('a2\n')
  expect(recorded('/w/a.ts', 'txt')).toBe('a0\n')
  const json = (path: string) => JSON.parse(recorded(path, 'json')!) as { path: string; state: string; toolUseId: unknown }
  expect([json('/w/a.ts').path, json('/w/a.ts').state, typeof json('/w/a.ts').toolUseId]).toEqual(['/w/a.ts', 'text', 'string'])
  expect([json('/w/new.ts').path, json('/w/new.ts').state]).toEqual(['/w/new.ts', 'absent'])
  expect(recorded('/w/new.ts', 'txt')).toBeUndefined()
  expect(recorded('/w/missing.ts', 'json')).toBeUndefined()
})

test('セッションの開始時に、保存期間を過ぎたほかのセッションの記録だけを消す', async ($, on) => {
  const now = 100 * 24 * 60 * 60 * 1000
  const ran: string[][] = []
  stubStore(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: now }))
  on('process.hookEnv', () => ({ value: PLUGIN_ENV }))
  on('fs.list', (_, e) => ({
    value:
      e.path === '/data/first-touches'
        ? ['old', 's1', 'recent'].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }))
        : [],
  }))
  on('fs.stat', (_, e) => ({ value: { kind: 'dir', size: 0, mtimeMs: e.path.endsWith('recent') ? now - 1000 : 0, isLink: false } }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return PLAIN_RUN
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(ran).toEqual([['rm', '-rf', '--', '/data/first-touches/old']])
})

test('差分の中身は、展開したファイルの分だけ、そのファイルに絞って読む', async ($, on) => {
  const { clock, seen } = stubOverview(on)
  const ui = await openList($, clock)
  expect(seen.patched).toEqual([])
  await ui.press({ key: 'name:/repo/src/c.ts' })
  expect(await ui.find({ type: 'Text', text: /読み込み中/ })).toBeDefined()
  await clock.settle()
  expect(seen.patched.at(-1)).toEqual([':(top,literal)src/c.ts'])
  expect((await ui.findAll({ type: 'Code' })).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('名前を変えたファイルは git と同じ形で書き、展開したら元の名前と合わせて読む', async ($, on) => {
  const { clock, seen } = stubOverview(on, {
    numstat: ['1\t1\t', 'src/edit-me.ts', 'src/edited.ts', '0\t0\t', 'src/pure.ts', 'lib/pure.ts', ''].join('\0'),
    gitDiff: [
      'diff --git a/src/edit-me.ts b/src/edited.ts',
      'rename from src/edit-me.ts',
      'rename to src/edited.ts',
      '--- a/src/edit-me.ts',
      '+++ b/src/edited.ts',
      '@@ -2 +2 @@',
      '-b',
      '+B',
      '',
    ].join('\n'),
  })
  const ui = await openList($, clock)
  expect(labelOf(await ui.find({ key: 'name:/repo/src/edited.ts' }))).toBe('src/{edit-me.ts => edited.ts}')
  expect(await ui.find({ type: 'Text', text: '{src => lib}/pure.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /名前の変更のみ/ })).toBeDefined()
  await ui.press({ key: 'name:/repo/src/edited.ts' })
  await clock.settle()
  expect(seen.patched.at(-1)).toEqual([':(top,literal)src/edited.ts', ':(top,literal)src/edit-me.ts'])
  expect((await ui.findAll({ type: 'Code' })).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('変更されたファイルが 500 件を超えたら、一覧を出さずに件数だけを書く', async ($, on) => {
  const numstat = Array.from({ length: 501 }, (_, i) => `1\t0\tsrc/f${i}.ts\0`).join('')
  const { clock, seen } = stubOverview(on, { numstat })
  const ui = await openList($, clock)
  expect(await ui.find({ type: 'Text', text: '変更されたファイルが 501 件あるため、一覧を省略しました' })).toBeDefined()
  expect(await ui.find({ key: 'file:/repo/src/f0.ts' })).toBeUndefined()
  expect(seen.patched).toEqual([])
  await ui.unmount()
})

test('git が時間内に終わらなかったときは、前の一覧を残してそう書く', async ($, on) => {
  let failing = false
  const { clock } = stubOverview(on, { gitFails: () => failing })
  const ui = await openList($, clock)
  failing = true
  await ui.press({ key: 'reload' })
  await clock.settle()
  expect(await fileKeys(ui)).toContain('file:/repo/src/c.ts')
  expect(await ui.find({ type: 'Text', text: /git が時間内に終わらなかったため、前の一覧を出しています（10 秒あけて読み直します）/ })).toBeDefined()
  await ui.unmount()
})

test('未追跡のファイルは中身を読んで行数を数え、展開したら全行を追加として出す', async ($, on) => {
  const { clock } = stubOverview(on, { untracked: { 'src/new.ts': 'a\nb\n', 'src/empty.ts': '' } })
  const ui = await openList($, clock)
  expect(labelOf(await ui.find({ key: 'file:/repo/src/new.ts' }))).toContain('+2')
  expect(await ui.find({ type: 'Text', text: /空のファイル/ })).toBeDefined()
  await ui.press({ key: 'name:/repo/src/new.ts' })
  await clock.settle()
  expect((await ui.findAll({ type: 'Code' })).map(c => String(c.props.source))).toEqual(expect.arrayContaining(['a', 'b']))
  await ui.unmount()
})

test('git check-ignore が失敗しても一覧全体を読み込み失敗にしない', async ($, on) => {
  const { clock } = stubOverview(on, { refuses: argv => argv.includes('check-ignore') })
  const ui = await openList($, clock)
  expect(await ui.find({ key: 'file:/repo/src/c.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /読み込めなかった/ })).toBeUndefined()
  await ui.unmount()
})

test('Claude Code が読み取りを断ったファイルだけを比較不可にし、一緒に展開したほかのファイルは出す', async ($, on) => {
  const { clock, seen } = stubOverview(on, {
    refuses: argv => argv.includes(':(top,literal)src/c.ts') || (argv[0] === 'diff' && argv.includes('/home/u/.claude/mods/a.ts')),
  })
  const ui = await openList($, clock)
  expect(await ui.find({ key: 'ask:/home/u/.claude/mods/a.ts' })).toBeUndefined()
  expect(await fileKeys(ui)).toContain('file:/repo/.local/x.html')
  await ui.press({ key: 'toggle-all' })
  await clock.settle()
  expect(await ui.find({ key: 'ask:/repo/src/c.ts' })).toBeUndefined()
  expect(await ui.find({ key: 'ask:/repo/src/c.test.ts' })).toBeDefined()
  expect(seen.patched).toEqual([[':(top,literal)src/c.test.ts']])
  await ui.unmount()
})

test('ask を押したファイルの差分を次の送信に付け、帯に数を出し、送ったら外す', async ($, on) => {
  const { clock } = stubOverview(on)
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  const ui = await openList($, clock)
  await ui.press({ key: 'ask:/repo/src/c.ts' })
  expect(labelOf(await ui.find({ key: 'ask:/repo/src/c.ts' }))).toBe('ask ✓')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(labelOf(await band.find({ key: 'open-diff' }))).toBe('diff · ask 1')
  await $.prompt.submit({ text: 'これを見て', wait: false, origin: { kind: 'composer' } })
  expect(context).toHaveLength(1)
  expect(context[0]).toContain('The user attached the diff of /repo/src/c.ts')
  expect(context[0]).toContain('+c1')
  expect(labelOf(await ui.find({ key: 'ask:/repo/src/c.ts' }))).toBe('ask')
  expect(labelOf(await band.find({ key: 'open-diff' }))).toBe('diff')
  await band.unmount()
  await ui.unmount()
})

test('ask を押してから範囲を切り替えると、ask を外して帯の数も消す', async ($, on) => {
  const { clock } = stubOverview(on)
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  const ui = await openList($, clock)
  await ui.press({ key: 'ask:/repo/src/c.ts' })
  await clock.settle()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(labelOf(await band.find({ key: 'open-diff' }))).toBe('diff · ask 1')
  await pickRange(ui, 't:u2')
  await clock.settle()
  expect(labelOf(await band.find({ key: 'open-diff' }))).toBe('diff')
  await $.prompt.submit({ text: 'これを見て', wait: false, origin: { kind: 'composer' } })
  expect(context).toEqual([])
  await band.unmount()
  await ui.unmount()
})

test('ask の差分が送信から 3 秒で読み終わらなければ、付けずに送ってそう知らせ、次の送信で付ける', async ($, on) => {
  const { clock, seen } = stubOverview(on, { slowMs: 10_000 })
  const contexts: (readonly string[])[] = []
  on('prompt.submit', (_, e) => {
    contexts.push(e.context ?? [])
    return { text: e.text }
  })
  await $.command.run({ ...RUN, command: 'session-delta', args: '' })
  await clock.settle()
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...OVERVIEW_PANE, surface: 'terminal' })
  await ui.press({ key: 'ask:/repo/src/c.ts' })
  await clock.settle()
  const sent = $.prompt.submit({ text: '一回目', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  await clock.advance(3_000)
  await sent
  expect(contexts.at(-1)).toEqual([])
  expect(seen.toasts).toEqual(['ask の 1 件は差分をまだ読めていないため、次の送信で添えます'])
  expect(labelOf(await ui.find({ key: 'ask:/repo/src/c.ts' }))).toBe('ask ✓')
  await clock.advance(7_000)
  await $.prompt.submit({ text: '二回目', wait: false, origin: { kind: 'composer' } })
  expect(contexts.at(-1)?.[0]).toContain('+c1')
  await ui.unmount()
})

test('選んだターンは、前のメッセージが読める範囲から外れても同じターンを指し、ターンが消えたら範囲を戻して知らせる', async ($, on) => {
  const messages = [...OVERVIEW_MESSAGES]
  const { clock, seen } = stubOverview(on, { messages })
  const ui = await openList($, clock)
  await pickRange(ui, 't:u2')
  await clock.settle()
  expect(await fileKeys(ui)).toEqual(['file:/repo/src/c.test.ts'])
  messages.splice(0, 2)
  await ui.press({ key: 'reload' })
  await clock.settle()
  expect(labelOf(await ui.find({ key: 'range' }))).toBe('「次の依頼でテストも直す」 ▾')
  expect(await fileKeys(ui)).toEqual(['file:/repo/src/c.test.ts'])
  messages.splice(0, 2)
  await ui.press({ key: 'reload' })
  await clock.settle()
  expect(labelOf(await ui.find({ key: 'range' }))).toBe('このセッション ▾')
  expect(seen.toasts).toEqual(['選んでいたターンが会話の記録に無くなったため、範囲を「このセッション」に戻しました'])
  expect(await fileKeys(ui)).toContain('file:/repo/src/c.ts')
  await ui.unmount()
})

test('ターンが消えたと分かる前に別の範囲を選んでいたら、その選択を残して知らせない', async ($, on) => {
  const messages = [...OVERVIEW_MESSAGES]
  let delay = 0
  const { clock, seen } = stubOverview(on, { messages, messagesDelayMs: () => delay })
  const ui = await openList($, clock)
  await pickRange(ui, 't:u2')
  await clock.settle()
  messages.splice(0, messages.length)
  delay = 1000
  await ui.press({ key: 'reload' })
  await clock.settle()
  await pickRange(ui, 'branch')
  delay = 0
  await clock.advance(1000)
  await clock.settle()
  expect(labelOf(await ui.find({ key: 'range' }))).toBe('ブランチ全体 ▾')
  expect(seen.toasts).toEqual([])
  await ui.unmount()
})

test('変更されたファイルが多いときは、一覧の行の分を差し引いて差分を出し、ツリーの上限を超えない', async ($, on) => {
  const rel = (i: number) => `f${i}.test.ts`
  const pairs = (i: number) => (i === 0 ? 480 : 1)
  const block = (i: number) => [
    `diff --git a/${rel(i)} b/${rel(i)}`,
    `@@ -1,${pairs(i)} +1,${pairs(i)} @@`,
    ...Array.from({ length: pairs(i) }, () => ['-x=a;', '+x=b;']).flat(),
  ]
  const gitDiff = Array.from({ length: 500 }, (_, i) => block(i).join('\n')).join('\n') + '\n'
  const numstat = Array.from({ length: 500 }, (_, i) => `${pairs(i)}\t${pairs(i)}\t${rel(i)}\0`).join('')
  const { clock } = stubOverview(on, { gitDiff, numstat })
  const look = await $.ui.mount({ ...LOOK, surface: 'terminal' })
  await look.press({ key: 'style-word' })
  await look.unmount()
  const ui = await openList($, clock)
  await ui.press({ key: 'toggle-all' })
  await clock.settle()
  await expect(ui.drawn()).resolves.toMatchObject({ type: 'Box' })
  expect(await ui.find({ type: 'Text', text: /表示できる量を超えたため省略/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Code' })).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('送信時に差分を付けられなくなった ask は外し、そう知らせる', async ($, on) => {
  const { clock, seen } = stubOverview(on, { refuses: argv => argv.includes('-p') && argv.some(a => a.endsWith('src/c.ts')) })
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  const ui = await openList($, clock)
  await ui.press({ key: 'ask:/repo/src/c.ts' })
  await clock.settle()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(labelOf(await band.find({ key: 'open-diff' }))).toBe('diff · ask 1')
  await $.prompt.submit({ text: 'これを見て', wait: false, origin: { kind: 'composer' } })
  expect(context).toEqual([])
  expect(seen.toasts).toEqual(['ask の 1 件は差分を添えられないため外しました'])
  expect(labelOf(await band.find({ key: 'open-diff' }))).toBe('diff')
  await band.unmount()
  await ui.unmount()
})

test('変更一覧を閉じていても、ask を押したファイルは編集のあとに読み直し、送信には新しい差分を付ける', async ($, on) => {
  let diff = GIT_DIFF
  const { clock } = stubOverview(on, { gitDiff: () => diff })
  on('tool.call', () => ({ result: { stdout: '' } as never }))
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  const ui = await openList($, clock)
  await ui.press({ key: 'ask:/repo/src/c.ts' })
  await clock.settle()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'open-diff' })
  await ui.unmount()
  diff = GIT_DIFF.replace('+c1', '+c2')
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  await clock.advance(10_000)
  await $.prompt.submit({ text: 'これを見て', wait: false, origin: { kind: 'composer' } })
  expect(context[0]).toContain('+c2')
  await band.unmount()
})

test('編集のあとの読み直しが始まる前に送っても、ask には新しい差分を付ける', async ($, on) => {
  let diff = GIT_DIFF
  const { clock } = stubOverview(on, { gitDiff: () => diff })
  on('tool.call', () => ({ result: { stdout: '' } as never }))
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  const ui = await openList($, clock)
  await ui.press({ key: 'ask:/repo/src/c.ts' })
  await clock.settle()
  diff = GIT_DIFF.replace('+c1', '+c2')
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  await $.prompt.submit({ text: 'これを見て', wait: false, origin: { kind: 'composer' } })
  expect(context[0]).toContain('+c2')
  await ui.unmount()
})

test('編集のあとの読み直しが送信から 3 秒で終わらなければ、前に読んだ差分を添えてそう知らせる', async ($, on) => {
  let diff = GIT_DIFF
  const { clock, seen } = stubOverview(on, { slowMs: 10_000, gitDiff: () => diff })
  on('tool.call', () => ({ result: { stdout: '' } as never }))
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  await $.command.run({ ...RUN, command: 'session-delta', args: '' })
  await clock.settle()
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...OVERVIEW_PANE, surface: 'terminal' })
  await ui.press({ key: 'ask:/repo/src/c.ts' })
  await clock.settle()
  await clock.advance(10_000)
  diff = GIT_DIFF.replace('+c1', '+c2')
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  await clock.settle()
  const sent = $.prompt.submit({ text: 'これを見て', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  await clock.advance(3_000)
  await sent
  expect(context[0]).toContain('+c1')
  expect(context[0]).not.toContain('+c2')
  expect(seen.toasts).toEqual(['ask の 1 件は編集のあとの差分を読めず、編集の前に読んだ差分を添えました'])
  await clock.advance(10_000)
  await ui.unmount()
})

test('編集のあとの読み直しが git を使えずに終わったら、前に読んだ差分を添えてそう知らせる', async ($, on) => {
  let diff = GIT_DIFF
  let failing = false
  const { clock, seen } = stubOverview(on, { gitDiff: () => diff, gitFails: () => failing })
  on('tool.call', () => ({ result: { stdout: '' } as never }))
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  const ui = await openList($, clock)
  await ui.press({ key: 'ask:/repo/src/c.ts' })
  await clock.settle()
  diff = GIT_DIFF.replace('+c1', '+c2')
  failing = true
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  await $.prompt.submit({ text: 'これを見て', wait: false, origin: { kind: 'composer' } })
  expect(context[0]).toContain('+c1')
  expect(seen.toasts).toEqual(['ask の 1 件は編集のあとの差分を読めず、編集の前に読んだ差分を添えました'])
  await ui.unmount()
})

test('編集が無ければ、別のファイルの読み込みが送信から 3 秒で終わらなくても、読み終えた差分を古いとは知らせない', async ($, on) => {
  const { clock, seen } = stubOverview(on, { slowMs: 10_000 })
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  await $.command.run({ ...RUN, command: 'session-delta', args: '' })
  await clock.settle()
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...OVERVIEW_PANE, surface: 'terminal' })
  await ui.press({ key: 'ask:/repo/src/c.ts' })
  await clock.settle()
  await clock.advance(10_000)
  await ui.press({ key: 'ask:/repo/src/c.test.ts' })
  await clock.settle()
  const sent = $.prompt.submit({ text: 'これを見て', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  await clock.advance(3_000)
  await sent
  expect(context[0]).toContain('+c1')
  expect(seen.toasts).toEqual(['ask の 1 件は差分をまだ読めていないため、次の送信で添えます'])
  await clock.advance(10_000)
  await ui.unmount()
})

test('編集が無ければ、関係ない読み込みの最中に送っても待たずに ask の差分を付ける', async ($, on) => {
  const { clock } = stubOverview(on, { slowMs: 10_000 })
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  await $.command.run({ ...RUN, command: 'session-delta', args: '' })
  await clock.settle()
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...OVERVIEW_PANE, surface: 'terminal' })
  await ui.press({ key: 'ask:/repo/src/c.ts' })
  await clock.settle()
  await clock.advance(10_000)
  await ui.press({ key: 'reload' })
  await clock.settle()
  await $.prompt.submit({ text: 'これを見て', wait: false, origin: { kind: 'composer' } })
  expect(context[0]).toContain('+c1')
  await clock.advance(10_000)
  await ui.unmount()
})

test('スラッシュコマンドの送信には ask の差分を付けず、印も残す', async ($, on) => {
  const { clock } = stubOverview(on)
  const contexts: (readonly string[])[] = []
  on('prompt.submit', (_, e) => {
    contexts.push(e.context ?? [])
    return { text: e.text }
  })
  const ui = await openList($, clock)
  await ui.press({ key: 'ask:/repo/src/c.ts' })
  await $.prompt.submit({ text: '/session-delta colors', wait: false, origin: { kind: 'composer' }, command: { name: 'session-delta', args: 'colors' } as never })
  expect(contexts.at(-1)).toEqual([])
  expect(labelOf(await ui.find({ key: 'ask:/repo/src/c.ts' }))).toBe('ask ✓')
  await ui.unmount()
})

test('閉じたことを知らせずに枠が落ちても、diff ボタンでまた開ける', async ($, on) => {
  const { seen } = stubOverview(on)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'open-diff' })
  await band.press({ key: 'open-diff' })
  await band.press({ key: 'open-diff' })
  await band.unmount()
  expect(seen.opened).toEqual(['session-delta-overview', 'session-delta-overview'])
})

test('1 列表示では、離れたハンクの間に省いた行数を挟む', async ($, on) => {
  const { clock } = stubOverview(on, {
    gitDiff: 'diff --git a/src/c.ts b/src/c.ts\n@@ -3 +3 @@\n-a\n+b\n@@ -10 +10 @@\n-c\n+d\n',
    numstat: '2\t2\tsrc/c.ts\0',
  })
  const ui = await openList($, clock)
  await ui.press({ key: 'toggle-all' })
  await clock.settle()
  const gaps = (await ui.findAll({ type: 'Text', text: /⋯/ })).map(t => t.text.trim())
  expect(gaps.slice(0, 2)).toEqual(['⋯ 2 行', '⋯ 6 行'])
  await ui.unmount()
})

test('読み込み中に重ねて頼んでも、読み込みは 1 本ずつ走り、終わってから 1 回だけやり直す', async ($, on) => {
  const { clock, seen } = stubOverview(on, { slowMs: 100 })
  const ui = await openList($, clock)
  await ui.press({ key: 'reload' })
  await ui.press({ key: 'reload' })
  await clock.settle()
  expect(seen.diffedAgainst).toEqual([])
  await clock.advance(100)
  expect(seen.diffedAgainst).toHaveLength(1)
  await clock.advance(100)
  expect(seen.diffedAgainst).toHaveLength(2)
  await clock.advance(1000)
  expect(seen.diffedAgainst).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: '読み込み中…' })).toBeUndefined()
  await ui.unmount()
})

test('範囲の値・増減の書き方・一覧に出ているファイル', () => {
  expect(rangeValue('session', '')).toBe('session')
  expect(rangeValue('branch', 'u3')).toBe('t:u3')
  expect(rangeOf('t:u12')).toEqual({ turn: 'u12' })
  expect(rangeOf('branch')).toEqual({ base: 'branch', turn: '' })
  expect(rangeOf('uncommitted')).toEqual({ base: 'session', turn: '' })
  expect(rangeOf('t:')).toEqual({ base: 'session', turn: '' })
  expect(countLabel(3, 0)).toBe('+3')
  expect(countLabel(0, 2)).toBe('-2')
  expect(countLabel(3, 2)).toBe('+3 -2')
  expect(toggled(['a'], 'b')).toEqual(['a', 'b'])
  expect(toggled(['a', 'b'], 'a')).toEqual(['b'])
  const file = (path: string) => ({ path, display: path, added: 1, removed: 0, hunks: [] })
  const data = { groups: [{ title: 't', files: [file('p'), file('q.test.ts')], earlier: [file('old')] }], turns: [] }
  expect(shownFiles(data, false).map(f => f.path)).toEqual(['p', 'q.test.ts'])
  expect(shownFiles(data, true).map(f => f.path)).toEqual(['p', 'q.test.ts', 'old'])
})

test('送信時に ask のファイルを、添える・次に回す・外すに分け、一覧が書き換えの前のものなら外さずに次に回す', () => {
  const hunk = { oldStart: 1, newStart: 1, lines: ['-a', '+b'] }
  const file = (path: string, hunks: (typeof hunk)[] | null) => ({ path, display: path, added: 1, removed: 1, hunks })
  const files = [file('ready', [hunk]), file('loading', null), file('empty', [])]
  const list = ['ready', 'loading', 'empty', 'gone']
  expect(sortAsked(list, files, true)).toEqual({ ready: [{ path: 'ready', hunks: [hunk] }], waiting: ['loading'], dropped: 2, stale: 0 })
  expect(sortAsked(list, files, false)).toEqual({
    ready: [{ path: 'ready', hunks: [hunk] }],
    waiting: ['loading', 'empty', 'gone'],
    dropped: 0,
    stale: 1,
  })
})

test('ターンやブランチ全体からこのセッションに戻せる', async ($, on) => {
  const { clock, seen } = stubOverview(on)
  const ui = await openList($, clock)
  await pickRange(ui, 't:u1')
  await clock.settle()
  expect(await ui.find({ key: 'earlier' })).toBeUndefined()
  await pickRange(ui, 'session')
  await clock.settle()
  expect(await ui.find({ key: 'earlier' })).toBeDefined()
  await pickRange(ui, 'branch')
  await clock.settle()
  expect(seen.diffedAgainst.at(-1)).toBe('abc123')
  await pickRange(ui, 'session')
  await clock.settle()
  expect(seen.diffedAgainst.at(-1)).toBe('HEAD')
  expect(await ui.find({ key: 'earlier' })).toBeDefined()
  await ui.unmount()
})

test('範囲のボタンを押すと選択肢が並び、選ぶと切り替わって閉じ、いまの選択肢を押しても閉じる', async ($, on) => {
  const { clock } = stubOverview(on)
  const ui = await openList($, clock)
  expect(labelOf(await ui.find({ key: 'range' }))).toBe('このセッション ▾')
  expect(await ui.find({ key: 'range:session' })).toBeUndefined()
  await ui.press({ key: 'range' })
  expect(labelOf(await ui.find({ key: 'range:session' }))).toBe('● このセッション')
  expect(labelOf(await ui.find({ key: 'range:t:u2' }))).toBe('○ 「次の依頼でテストも直す」')
  await ui.press({ key: 'range:session' })
  expect(await ui.find({ key: 'range:session' })).toBeUndefined()
  await pickRange(ui, 't:u2')
  await clock.settle()
  expect(labelOf(await ui.find({ key: 'range' }))).toBe('「次の依頼でテストも直す」 ▾')
  await ui.unmount()
})

test('範囲の選択肢は、このセッション・ブランチ全体と、新しいターン 63 件までを 10 件ずつのページで出す', () => {
  const data = { groups: [], turns: Array.from({ length: 70 }, (_, i) => ({ id: `u${70 - i}`, preview: `t${70 - i}` })) }
  expect(turnPages(data)).toBe(7)
  const ja = MESSAGES.ja
  expect(rangeOptions(data, 0, ja).map(o => o.value).slice(0, 4)).toEqual(['session', 'branch', 't:u70', 't:u69'])
  expect(rangeOptions(data, 0, ja)).toHaveLength(12)
  expect(rangeOptions(data, 6, ja).map(o => o.value)).toEqual(['session', 'branch', 't:u10', 't:u9', 't:u8'])
  expect(rangeOptions(data, 99, ja)).toEqual(rangeOptions(data, 6, ja))
  expect(pageSpan(data, 6)).toEqual({ from: 61, to: 63, count: 63 })
  expect(pageOf(data, 't:u55')).toBe(1)
  expect(pageOf(data, 'branch')).toBe(0)
  expect(rangeLabel(data, 't:u55', ja)).toBe('「t55」')
  expect(rangeLabel(data, 'branch', ja)).toBe('ブランチ全体')
  expect(turnPages({ groups: [], turns: [] })).toBe(1)
})

const turnMessages = (count: number): SessionMessage[] =>
  Array.from({ length: count }, (_, i) => [
    { role: 'user' as const, text: `依頼 ${i + 1}`, toolUses: [], uuid: `u${i + 1}` },
    { role: 'assistant' as const, text: '', toolUses: [editUse(`e${i}`, '/repo/src/c.ts', ['-c0', '+c1'])] },
  ]).flat()

test('範囲の選択肢はページを送れ、ページの外のターンを選んでいてもボタンにその名前を出す', async ($, on) => {
  const { clock } = stubOverview(on, { messages: turnMessages(12) })
  const ui = await openList($, clock)
  await ui.press({ key: 'range' })
  expect(await ui.find({ key: 'turns-newer' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'ターン 1–10 / 12' })).toBeDefined()
  await ui.press({ key: 'turns-older' })
  expect(await ui.find({ type: 'Text', text: 'ターン 11–12 / 12' })).toBeDefined()
  expect(await ui.find({ key: 'turns-older' })).toBeUndefined()
  await ui.press({ key: 'range:t:u1' })
  await clock.settle()
  expect(labelOf(await ui.find({ key: 'range' }))).toBe('「依頼 1」 ▾')
  await ui.press({ key: 'range' })
  expect(await ui.find({ key: 'range:t:u1' })).toBeDefined()
  await ui.unmount()
})


test('一覧の見積もりは、表示するファイルの行ごとに 22 ノードを足し、畳んだセッション開始前のファイルは数えない', () => {
  const file = (path: string) => ({ path, display: path, added: 1, removed: 0, hunks: null })
  const data = { groups: [{ title: 'r', files: [file('a'), file('b')], earlier: [file('c')] }], turns: [] }
  const folded = listCost(data, false)
  expect(listCost(data, true).nodes - folded.nodes).toBe(22)
  expect(folded.nodes - listCost({ groups: [{ title: 'r', files: [], earlier: [file('c')] }], turns: [] }, false).nodes).toBe(44)
})
