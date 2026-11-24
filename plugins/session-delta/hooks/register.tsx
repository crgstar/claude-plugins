import { atom, memberOf, read, update } from 'claude-code'
import type { CoreEngineInterface, Register } from 'claude-code'

import type { DiffBase, DiffMode, NoiseKind, Overview, OverviewFile, PaneLayout } from '../types'
import { diffSourceOf, fitHatch, HATCH, levelLabel, planView, pressTarget, toRows, treeCost, TREE_BUDGET, type Cell, type Hunk, type Row } from './diff'
import { cellWidth, DEFAULT_STYLE, expandTabs, HATCH_COLOR, isStyle, numberWidth, STYLES, styleSpec, TERMINAL_BG, wordSpans, type Span, type StyleSpec } from './look'
import { MESSAGES, pickLocale, posixLocaleOf, type Locale, type Messages } from './locale'
import { GitUnavailable, loadOverview } from './overview'
import { autoDelay, nextPace, type Pace } from './pace'
import { askText } from './turns'
import { hunkGaps, pairRows, toUnifiedRows, type UnifiedRow } from './pane'
import { captureBefore, dropCapture, removeStale, saveCapture, writtenPath } from './touches'
const MODE_KEY = 'mode'
const STYLE_KEY = 'style'
const LAYOUT_KEY = 'paneLayout'
const CHAT_LAYOUT_KEY = 'chatLayout'
const LOOK_PANE = 'session-delta-look'
const OVERVIEW_PANE = 'session-delta-overview'

const mode = atom({ plugin: 'session-delta', key: 'mode' } as const, 'split' as DiffMode)
const style = atom({ plugin: 'session-delta', key: 'style' } as const, DEFAULT_STYLE)
const paneLayout = atom({ plugin: 'session-delta', key: 'paneLayout' } as const, 'unified' as PaneLayout)
const chatLayout = atom({ plugin: 'session-delta', key: 'chatLayout' } as const, 'split' as PaneLayout)
const context = atom({ plugin: 'session-delta', key: 'context' } as const, 0)
const overview = atom({ plugin: 'session-delta', key: 'overview' } as const, { groups: [], turns: [] } as Overview, { shape: 'overview-5' })
const expanded = atom({ plugin: 'session-delta', key: 'expanded' } as const, [] as string[], { shape: 'expanded-1' })
const rangeMenuOpen = atom({ plugin: 'session-delta', key: 'rangeMenuOpen' } as const, false)
const turnPage = atom({ plugin: 'session-delta', key: 'turnPage' } as const, 0)
const overviewOpen = atom({ plugin: 'session-delta', key: 'overviewOpen' } as const, false)
const base = atom({ plugin: 'session-delta', key: 'base' } as const, 'session' as DiffBase)
const earlierOpen = atom({ plugin: 'session-delta', key: 'earlierOpen' } as const, false)
const asked = atom({ plugin: 'session-delta', key: 'asked' } as const, [] as string[], { shape: 'asked-1' })
const turn = atom({ plugin: 'session-delta', key: 'turn' } as const, '')
const loading = atom({ plugin: 'session-delta', key: 'loading' } as const, false)
const BASE_KEY = 'base'
const BASE_IDS: readonly DiffBase[] = ['session', 'branch']
const isBase = (v: unknown): v is DiffBase => BASE_IDS.includes(v as DiffBase)

type OverviewEngine = Pick<CoreEngineInterface, 'session' | 'process' | 'fs' | 'settings' | 'env' | 'state' | 'ui' | 'clock'>
type LocaleEngine = Pick<CoreEngineInterface, 'settings' | 'env'>

const quiet = <T,>(read: () => Promise<T>) => Promise.resolve().then(read).catch(() => undefined)

async function readLocale($: LocaleEngine): Promise<Locale> {
  const [settings, lcAll, lcMessages, lang] = await Promise.all([
    quiet(() => $.settings.read() as Promise<{ language?: unknown }>),
    quiet(() => $.env.get('LC_ALL')),
    quiet(() => $.env.get('LC_MESSAGES')),
    quiet(() => $.env.get('LANG')),
  ])
  return pickLocale(settings?.language, posixLocaleOf(lcAll, lcMessages, lang))
}

// 設定の言語は最初に要ったときに 1 回だけ読む。register が null に戻す。
let localeRead: Promise<Locale> | null = null
const messagesOf = async ($: LocaleEngine): Promise<Messages> => MESSAGES[await (localeRead ??= readLocale($))]

// 重ねて走らせると、先に始めた古い結果があとから上書きする。走っているあいだの依頼は again を true にするだけにして、終わってから 1 回だけやり直す。
let inFlight: Promise<void> | null = null
let again = false
let pace: Pace = { waitMs: 0, unavailable: 0 }
let readyAt = 0
// edits は Edit・Write・NotebookEdit・Bash を呼んだ回数。loadedEdits は、一覧に読み込めた内容がその何回目までの呼び出しを反映しているか。
// loadedEdits が edits より小さければ、一覧の差分は編集の前のものかもしれない（読み直しが終わっていないか、git が使えず前の一覧が残っている）。
let edits = 0
let loadedEdits = 0

const wantedPaths = async ($: OverviewEngine) => new Set([...(await read($, expanded)), ...(await read($, asked))])

/** 走っている読み込みがあれば、その終わり（やり直しを含む）を返す。 */
function refreshOverview($: OverviewEngine): Promise<void> {
  if (inFlight !== null) {
    again = true
    return inFlight
  }
  const run = async (): Promise<void> => {
    await update($, loading, () => true)
    try {
      do {
        again = false
        const seen = edits
        const [b, t, want, m] = await Promise.all([read($, base), read($, turn), wantedPaths($), messagesOf($)])
        const result = await loadOverview($, b, t, want, m).then(
          loaded => ({ loaded }),
          (error: unknown) => ({ error }),
        )
        if ('loaded' in result && result.loaded.turnGone === true) {
          // 圧縮などで、選んでいたターンが会話の記録から消えることがある。
          // 読み込み中に別の範囲が選ばれていたら、その選択を消さない。
          let reset = false
          await update($, turn, current => {
            reset = current === t
            return reset ? '' : current
          })
          if (reset) {
            await update($, asked, () => [])
            $.ui.toast(m.turnGone(m.bases[b]))
          }
          again = true
        } else if ('loaded' in result) {
          pace = nextPace(result.loaded.gitMs, pace)
          await update($, overview, () => result.loaded.overview)
          loadedEdits = Math.max(loadedEdits, seen)
        } else if (result.error instanceof GitUnavailable) {
          pace = nextPace(null, pace)
          const note = m.gitSlow(pace.waitMs / 1000)
          await update($, overview, previous => ({ ...previous, note }))
        } else {
          await update($, overview, () => ({ groups: [], turns: [], note: m.loadFailed(String(result.error)) }))
        }
        readyAt = (await $.clock.now()) + pace.waitMs
      } while (again)
    } finally {
      await update($, loading, () => false)
    }
    // again は loading を戻している間にも立つ。do ループの外なので、ここで再実行しないと取りこぼす。
    if (again) await run()
  }
  inFlight = run().finally(() => {
    inFlight = null
  })
  return inFlight
}

// ボタンの処理には 10 秒の持ち時間があり、会話の記録の読み込みが長いセッションで超える。読み込みはタイマーから走らせる。
function scheduleRefresh($: OverviewEngine) {
  $.clock.after(0, () => {
    refreshOverview($).catch(() => undefined)
  })
}

async function openOverview($: OverviewEngine) {
  await update($, overviewOpen, () => true)
  await $.ui.open({ id: OVERVIEW_PANE, title: (await messagesOf($)).overviewTitle })
  scheduleRefresh($)
}

async function toggleOverview($: OverviewEngine) {
  if (!(await read($, overviewOpen))) return openOverview($)
  await update($, overviewOpen, () => false)
  await $.ui.close({ id: OVERVIEW_PANE }).catch(() => undefined)
}

/**
 * 送信時に、ask を押したファイルを、添える（ready）・次の送信に回す（waiting）・外す（dropped）に分ける。
 * fresh が false（一覧が最後の書き換えより前のもの）なら、一覧に無いか差分が無いファイルも、読み直せば出るかもしれないので外さずに次に回し、
 * 添える差分は古いかもしれないので stale に数える。
 */
export function sortAsked(list: readonly string[], files: readonly OverviewFile[], fresh: boolean) {
  const ready = files.flatMap(f => (f.hunks !== null && f.hunks.length > 0 ? [{ path: f.path, hunks: f.hunks }] : []))
  const attached = new Set(ready.map(f => f.path))
  const loading = new Set(files.filter(f => f.hunks === null).map(f => f.path))
  const rest = list.filter(p => !attached.has(p))
  const waiting = fresh ? rest.filter(p => loading.has(p)) : rest
  return { ready, waiting, dropped: rest.length - waiting.length, stale: fresh ? 0 : ready.length }
}

export const hasBody = (file: OverviewFile) => file.hunks === null || file.hunks.length > 0

/** 一覧に表示するファイル。セッション開始前の変更（earlier）は、earlierShown が true のときだけ含める。 */
export const shownFiles = (data: Overview, earlierShown: boolean): OverviewFile[] =>
  data.groups.flatMap(g => [...g.files, ...(earlierShown ? (g.earlier ?? []) : [])])

/**
 * 一覧のツリーのうち、差分の本文を除いた分の見積もり。
 * 1 ファイルの行は、枠の Box 4 つ・2 つのボタンとその中の文字・種類のバッジ・補足・ask・本文の代わりの 1 行で 22 ノードまで。
 */
export function listCost(data: Overview, earlierShown: boolean): { nodes: number; chars: number } {
  let nodes = 60
  let chars = 2000 + (data.note?.length ?? 0)
  for (const g of data.groups) {
    nodes += 6
    chars += g.title.length + 40
  }
  for (const f of shownFiles(data, earlierShown)) {
    nodes += 22
    chars += f.display.length + (f.note?.length ?? 0) + 60
  }
  return { nodes, chars }
}

const BADGES: Record<NoiseKind, { color: string; backgroundColor: string }> = {
  test: { color: '#9fb4cc', backgroundColor: '#2f3946' },
  generated: { color: '#a8a8a8', backgroundColor: '#3a3a3a' },
}

const turnValue = (id: string) => `t:${id}`

export function rangeValue(base: DiffBase, turn: string): string {
  return turn !== '' ? turnValue(turn) : base
}

export function rangeOf(value: string): { base: DiffBase; turn: string } | { turn: string } {
  if (value.startsWith('t:') && value.length > 2) return { turn: value.slice(2) }
  return { base: isBase(value) ? value : 'session', turn: '' }
}

const ASK_WAIT_MS = 3_000

const TURN_LIMIT = 63
const TURN_PAGE_SIZE = 10

const listedTurns = (data: Overview) => data.turns.slice(0, TURN_LIMIT)

export const turnPages = (data: Overview) => Math.max(1, Math.ceil(listedTurns(data).length / TURN_PAGE_SIZE))

export function rangeOptions(data: Overview, page: number, m: Messages) {
  const p = Math.min(Math.max(0, page), turnPages(data) - 1)
  return [
    ...BASE_IDS.map(id => ({ value: id as string, label: m.bases[id] })),
    ...listedTurns(data)
      .slice(p * TURN_PAGE_SIZE, (p + 1) * TURN_PAGE_SIZE)
      .map(t => ({ value: turnValue(t.id), label: m.turn(t.preview) })),
  ]
}

export function rangeLabel(data: Overview, value: string, m: Messages): string {
  const found = data.turns.find(t => turnValue(t.id) === value)
  return found === undefined ? m.bases[isBase(value) ? value : 'session'] : m.turn(found.preview)
}

export function pageOf(data: Overview, value: string): number {
  const i = listedTurns(data).findIndex(t => turnValue(t.id) === value)
  return i < 0 ? 0 : Math.floor(i / TURN_PAGE_SIZE)
}

export function pageSpan(data: Overview, page: number): { from: number; to: number; count: number } {
  const count = listedTurns(data).length
  return { from: page * TURN_PAGE_SIZE + 1, to: Math.min(count, (page + 1) * TURN_PAGE_SIZE), count }
}

export const countLabel = (added: number, removed: number) =>
  [added > 0 ? `+${added}` : '', removed > 0 ? `-${removed}` : ''].filter(t => t !== '').join(' ')

export const toggled = (list: readonly string[], path: string) =>
  list.includes(path) ? list.filter(p => p !== path) : [...list, path]

const isMode = (v: unknown): v is DiffMode => v === 'split' || v === 'original'
const isLayout = (v: unknown): v is PaneLayout => v === 'unified' || v === 'split'

export type CommandIntent = { mode: DiffMode } | { open: 'look' | 'overview' } | null

export function commandIntent(args: string): CommandIntent {
  const word = args.trim()
  if (word === '') return { open: 'overview' }
  if (word === 'on') return { mode: 'split' }
  if (word === 'off') return { mode: 'original' }
  if (word === 'colors') return { open: 'look' }
  return null
}

const SAMPLE_PATH = 'sample.ts'
const SAMPLE_ROWS = toRows([
  {
    oldStart: 1,
    newStart: 1,
    lines: [
      ' export function greet(name: string): string {',
      "-  const mark = '?'",
      "+  const mark = '!'",
      "+  const suffix = ' :)'",
      '   return `${prefix}, ${name}${mark}`',
      ' }',
    ],
  },
])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = { Box: any; Text: any; Code: any; terminal: boolean }

// 部分ごとに Box の width を表示幅で固定する。固定しないと、横に並べた Code の前のほうが縮められて `…` だけになる。
function fragments(el: El, path: string, spans: readonly Span[], color: string) {
  const { Box, Code } = el
  return (
    <Box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
      {spans.map(span => {
        const text = expandTabs(span.text)
        return (
          <Box width={cellWidth(text)} flexShrink={0} backgroundColor={span.changed ? color : undefined}>
            <Code source={text} path={path} wrap="truncate-end" />
          </Box>
        )
      })}
    </Box>
  )
}

function cellTree(el: El, path: string, cell: Cell, partner: Cell | null, width: number, spec: StyleSpec) {
  const { Text, Code } = el
  const number = <Text dimColor>{`${String(cell.n).padStart(width)} `}</Text>
  const marker = spec.marker && (
    <Text color={cell.kind === 'add' ? 'success' : cell.kind === 'del' ? 'error' : undefined}>
      {cell.kind === 'add' ? '+ ' : cell.kind === 'del' ? '- ' : '  '}
    </Text>
  )
  if (spec.word !== undefined && cell.kind !== 'same' && partner !== null && partner.kind !== 'same') {
    const spans =
      cell.kind === 'del' ? wordSpans(cell.text, partner.text).before : wordSpans(partner.text, cell.text).after
    return [number, fragments(el, path, spans, spec.word[cell.kind])]
  }
  return [number, marker, <Code source={cell.text === '' ? ' ' : cell.text} path={path} wrap="truncate-end" />]
}

function rowsTree(el: El, path: string, rows: readonly Row[], spec: StyleSpec, hatch: boolean, m: Messages) {
  const { Box, Text } = el
  const width = numberWidth(rows.flatMap(r => (r.type === 'line' ? [r.left?.n ?? 0, r.right?.n ?? 0] : [])))
  return (
    <Box flexDirection="column">
      {rows.map((row, i) =>
        row.type === 'gap' ? (
          <Text key={`gap-${i}`} dimColor>
            {`  ⋯ ${m.skippedLines(row.skipped)}`}
          </Text>
        ) : (
          <Box key={`row-${i}`} flexDirection="row">
            {[row.left, row.right].map((cell, side) => (
              <Box
                key={`row-${i}-${side}`}
                width="50%"
                flexDirection="row"
                backgroundColor={cell === null || cell.kind === 'same' ? undefined : spec.line[cell.kind]}
              >
                {cell === null
                  ? hatch &&
                    // 端末は wrap="clip" でも末尾に … を描くため、Box height={1} overflow="hidden" で折り返しの 2 行目以降を隠す。
                    // 端末以外は clip が … を描かず、height 1 が 1 行に当たる保証もないので clip のまま。
                    (el.terminal ? (
                      <Box flexGrow={1} height={1} overflow="hidden">
                        <Text color={HATCH_COLOR}>{HATCH}</Text>
                      </Box>
                    ) : (
                      <Text color={HATCH_COLOR} wrap="clip">
                        {HATCH}
                      </Text>
                    ))
                  : cellTree(el, path, cell, side === 0 ? row.right : row.left, width, spec)}
              </Box>
            ))}
          </Box>
        ),
      )}
    </Box>
  )
}

function unifiedTree(el: El, path: string, rows: readonly UnifiedRow[], spec: StyleSpec, numberCols?: number) {
  const { Box, Text, Code } = el
  const width = numberCols ?? numberWidth(rows.flatMap(r => [r.old ?? 0, r.new ?? 0]))
  const pad = (n: number | null) => (n === null ? ' '.repeat(width) : String(n).padStart(width))
  const partner = pairRows(rows)
  const body = (row: UnifiedRow, i: number) => {
    const other = partner[i]
    if (spec.word === undefined || row.kind === 'same' || other === null || other === undefined)
      return <Code source={row.text === '' ? ' ' : row.text} path={path} wrap="wrap" />
    const pair = rows[other]!
    const spans = row.kind === 'del' ? wordSpans(row.text, pair.text).before : wordSpans(pair.text, row.text).after
    return fragments(el, path, spans, spec.word[row.kind])
  }
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <Box
          key={`u-${i}`}
          flexDirection="row"
          backgroundColor={row.kind === 'same' ? undefined : spec.line[row.kind]}
        >
          <Text dimColor>{`${pad(row.old)} ${pad(row.new)} `}</Text>
          <Text color={row.kind === 'add' ? 'success' : row.kind === 'del' ? 'error' : undefined}>
            {row.kind === 'add' ? '+ ' : row.kind === 'del' ? '- ' : '  '}
          </Text>
          {body(row, i)}
        </Box>
      ))}
    </Box>
  )
}

function hunksTree(el: El, path: string, hunks: readonly Hunk[], gaps: readonly number[], spec: StyleSpec, m: Messages) {
  const { Text } = el
  const width = numberWidth(toUnifiedRows(hunks).flatMap(r => [r.old ?? 0, r.new ?? 0]))
  return hunks.map((hunk, i) => [
    gaps[i]! > 0 && <Text dimColor>{`  ⋯ ${m.skippedLines(gaps[i]!)}`}</Text>,
    unifiedTree(el, path, toUnifiedRows([hunk]), spec, width),
  ])
}

export const register: Register = on => {
  localeRead = null
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'session-delta', description: (await messagesOf($)).command.description })
    const savedMode = await $.store.get(MODE_KEY)
    if (isMode(savedMode)) await update($, mode, () => savedMode)
    const savedStyle = await $.store.get(STYLE_KEY)
    if (isStyle(savedStyle)) await update($, style, () => savedStyle)
    const savedLayout = await $.store.get(LAYOUT_KEY)
    if (isLayout(savedLayout)) await update($, paneLayout, () => savedLayout)
    const savedChatLayout = await $.store.get(CHAT_LAYOUT_KEY)
    if (isLayout(savedChatLayout)) await update($, chatLayout, () => savedChatLayout)
    const savedBase = await $.store.get(BASE_KEY)
    if (isBase(savedBase)) await update($, base, () => savedBase)
    // mod の読み込み直しでは ui.close フックが動かず、overviewOpen が true のまま残って帯のボタンが閉じる側にしか動かなくなる。
    // そのため session.start で false に戻す。
    await update($, overviewOpen, () => false)
    await update($, loading, () => false)
    await $.clock
      .now()
      .then(now => removeStale($, now))
      .catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'session-delta' }, async ($, e) => {
    const m = await messagesOf($)
    const intent = commandIntent(e.args)
    if (intent === null) return { text: m.command.badArgs }
    if ('open' in intent) {
      if (intent.open === 'look') await $.ui.open({ id: LOOK_PANE, title: m.lookTitle })
      else await openOverview($)
      return { text: intent.open === 'look' ? m.command.openedLook : m.command.openedOverview }
    }
    await update($, mode, () => intent.mode)
    await $.store.set(MODE_KEY, intent.mode)
    return { text: m.command[intent.mode] }
  })

  on('ui.render', { component: 'Pane', requestId: LOOK_PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const [current, m] = await Promise.all([read($, style), messagesOf($)])
    return (
      <Box flexDirection="column" gap={1} backgroundColor={TERMINAL_BG} minHeight={e.props.scroll.bodyRows}>
        {STYLES.map(spec => (
          <Box key={`look-${spec.id}`} flexDirection="column">
            <Box flexDirection="row" gap={2}>
              <Text bold>{m.styles[spec.id]}</Text>
              {spec.id === current ? (
                <Text color="success">{m.applied}</Text>
              ) : (
                <Button
                  key={`style-${spec.id}`}
                  onPress={async () => {
                    await update($, style, () => spec.id)
                    await $.store.set(STYLE_KEY, spec.id)
                  }}
                >
                  {m.apply}
                </Button>
              )}
            </Box>
            {rowsTree({ Box, Text, Code, terminal: e.surface === 'terminal' }, SAMPLE_PATH, SAMPLE_ROWS, spec, true, m)}
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: OVERVIEW_PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const el = { Box, Text, Code, terminal: e.surface === 'terminal' }
    const [data, opened, layout, styleId, currentBase, beforeOpen, askedList, currentTurn, isLoading, menuOpen, page, m] =
      await Promise.all([
        read($, overview),
        read($, expanded),
        read($, paneLayout),
        read($, style),
        read($, base),
        read($, earlierOpen),
        read($, asked),
        read($, turn),
        read($, loading),
        read($, rangeMenuOpen),
        read($, turnPage),
        messagesOf($),
      ])
    const spec = styleSpec(styleId)
    const openSet = new Set(opened)
    const askedSet = new Set(askedList)
    const shown = shownFiles(data, beforeOpen)
    const anyOpen = shown.some(f => hasBody(f) && openSet.has(f.path))
    const countWidth = Math.max(0, ...shown.map(f => cellWidth(countLabel(f.added, f.removed))))
    const word = spec.word !== undefined
    let spent = listCost(data, beforeOpen)
    const body = (file: OverviewFile) => {
      if (!openSet.has(file.path) || !hasBody(file)) return null
      if (file.hunks === null) return <Text dimColor>{`  ${m.loading}`}</Text>
      const rows = toRows(file.hunks)
      const left = { nodes: TREE_BUDGET.nodes - spent.nodes, chars: TREE_BUDGET.chars - spent.chars }
      const fit = fitHatch(rows, file.path, { budget: left, word })
      if (fit === null) return <Text dimColor>{`  ${m.overBudget}`}</Text>
      const hatch = layout === 'split' && fit.hatch
      const cost = treeCost(rows, file.path, { hatch, word })
      spent = { nodes: spent.nodes + cost.nodes, chars: spent.chars + cost.chars }
      if (layout === 'split')
        return rowsTree(el, file.path, currentTurn === '' ? rows : rows.filter(r => r.type === 'line'), spec, hatch, m)
      // ターン表示のハンクは複数の Edit をつないだもので、間の行数に意味がないので省略行を出さない。
      return hunksTree(el, file.path, file.hunks, currentTurn === '' ? hunkGaps(file.hunks) : file.hunks.map(() => 0), spec, m)
    }
    // 展開したファイルの差分だけを読むので、hunks が null のファイルは展開時に読み直す。
    const toggle = (file: OverviewFile) => async () => {
      await update($, expanded, list => toggled(list, file.path))
      if (file.hunks === null) scheduleRefresh($)
    }
    // ask は右端に揃える。パスの直後に置くと、パスの長さで行ごとに位置がずれるため。
    const fileRow = (file: OverviewFile) => {
      const counts = countLabel(file.added, file.removed)
      const pad = ' '.repeat(Math.max(0, countWidth - cellWidth(counts)))
      const marker = openSet.has(file.path) ? '▾' : '▸'
      const badge = file.noise === undefined ? null : BADGES[file.noise]
      return (
        <Box key={`file-box:${file.path}`} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Box flexDirection="row" gap={1} flexGrow={1} flexShrink={1}>
              {hasBody(file) ? (
                <Button key={`file:${file.path}`} plain onPress={toggle(file)}>
                  {`${marker} `}
                  <Text color="success">{file.added > 0 ? `+${file.added}` : ''}</Text>
                  {file.added > 0 && file.removed > 0 ? ' ' : ''}
                  <Text color="error">{file.removed > 0 ? `-${file.removed}` : ''}</Text>
                  {pad}
                </Button>
              ) : (
                <Text dimColor>{`  ${file.note ?? m.note.unavailable}`}</Text>
              )}
              {hasBody(file) ? (
                <Button key={`name:${file.path}`} plain onPress={toggle(file)}>
                  {file.display}
                </Button>
              ) : (
                <Text dimColor>{file.display}</Text>
              )}
              {badge !== null && (
                <Text color={badge.color} backgroundColor={badge.backgroundColor}>{` ${m.badges[file.noise!]} `}</Text>
              )}
              {hasBody(file) && file.note !== undefined && <Text dimColor>{file.note}</Text>}
            </Box>
            {hasBody(file) && (
              <Box flexShrink={0}>
                <Button
                  key={`ask:${file.path}`}
                  dimColor={!askedSet.has(file.path)}
                  onPress={async () => {
                    await update($, asked, list => toggled(list, file.path))
                    if (file.hunks === null) scheduleRefresh($)
                  }}
                >
                  {askedSet.has(file.path) ? 'ask ✓' : 'ask'}
                </Button>
              </Box>
            )}
          </Box>
          {body(file)}
        </Box>
      )
    }
    const options = rangeOptions(data, page, m)
    const current = rangeValue(currentBase, currentTurn)
    const currentLabel = rangeLabel(data, current, m)
    const pages = turnPages(data)
    const span = pageSpan(data, page)
    const pick = (value: string) => async () => {
      await update($, rangeMenuOpen, () => false)
      if (value === current) return
      const next = rangeOf(value)
      if ('base' in next) {
        await update($, base, () => next.base)
        await $.store.set(BASE_KEY, next.base)
      }
      await update($, turn, () => next.turn)
      // ask はいまの範囲の差分を添えるので、範囲を変えたら外す。残すと、新しい範囲の一覧に無いファイルが送信時に黙って落ちる。
      await update($, asked, () => [])
      scheduleRefresh($)
    }
    return (
      <Box flexDirection="column" backgroundColor={TERMINAL_BG} minHeight={e.props.scroll.bodyRows}>
        <Box flexDirection="row" gap={1}>
          <Button
            key="range"
            onPress={async () => {
              if (!menuOpen) await update($, turnPage, () => pageOf(data, current))
              await update($, rangeMenuOpen, v => !v)
            }}
          >
            {`${currentLabel} ${menuOpen ? '▴' : '▾'}`}
          </Button>
          <Button
            key="toggle-all"
            dimColor
            onPress={async () => {
              await update($, expanded, () => (anyOpen ? [] : shown.filter(hasBody).map(f => f.path)))
              if (!anyOpen && shown.some(f => f.hunks === null)) scheduleRefresh($)
            }}
          >
            {anyOpen ? m.collapseAll : m.expandAll}
          </Button>
          <Button
            key="layout"
            dimColor
            onPress={async () => {
              const to = layout === 'split' ? 'unified' : 'split'
              await update($, paneLayout, () => to)
              await $.store.set(LAYOUT_KEY, to)
            }}
          >
            {m.layouts[layout === 'split' ? 'unified' : 'split']}
          </Button>
          <Button key="reload" dimColor onPress={() => scheduleRefresh($)}>
            {m.refresh}
          </Button>
          {isLoading && <Text dimColor>{m.loading}</Text>}
        </Box>
        {menuOpen && (
          <Box flexDirection="column" paddingLeft={2}>
            {options.map(o => (
              <Button key={`range:${o.value}`} plain dimColor={o.value !== current} onPress={pick(o.value)}>
                {`${o.value === current ? '●' : '○'} ${o.label}`}
              </Button>
            ))}
            {pages > 1 && (
              <Box flexDirection="row" gap={1}>
                {page > 0 && (
                  <Button key="turns-newer" plain dimColor onPress={() => update($, turnPage, p => p - 1)}>
                    {m.newer}
                  </Button>
                )}
                <Text dimColor>{m.turnSpan(span.from, span.to, span.count)}</Text>
                {page < pages - 1 && (
                  <Button key="turns-older" plain dimColor onPress={() => update($, turnPage, p => p + 1)}>
                    {m.older}
                  </Button>
                )}
              </Box>
            )}
          </Box>
        )}
        {data.note !== undefined && <Text dimColor>{data.note}</Text>}
        {data.groups.length === 0 && !isLoading && <Text dimColor>{m.noChanges}</Text>}
        {data.groups.map((group, gi) => {
          const before = group.earlier ?? []
          return (
            <Box key={`group-${gi}`} flexDirection="column" marginTop={1}>
              <Text bold>{group.title}</Text>
              {group.files.map(fileRow)}
              {before.length > 0 && (
                <Button key="earlier" plain dimColor onPress={() => update($, earlierOpen, v => !v)}>
                  {`${beforeOpen ? '▾' : '▸'} ${m.earlier(before.length)}`}
                </Button>
              )}
              {beforeOpen && before.map(fileRow)}
            </Box>
          )
        })}
      </Box>
    )
  })

  // 書き換えが続くときに読み直しを重ねないよう、最後の呼び出しから少し待ってから 1 回だけ読み直す。
  let pending: { cancel: () => void } | null = null

  // 「ask」で選んだファイルの差分を、次の送信に context として付ける。スラッシュコマンドと isMeta の送信には付けず、
  // ask の選択も消さない（付けても届かずに消えるため）。
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true) return next(e)
    if ((await read($, asked)).length === 0) return next(e)
    // ask と一覧は待つあいだに変わりうる（選んだターンが会話の記録から消えると ask が空になる）ので、待ったあとにもう一度読む。
    const askedNow = async () => {
      const list = await read($, asked)
      return { list, files: shownFiles(await read($, overview), true).filter(f => list.includes(f.path)) }
    }
    let { list, files } = await askedNow()
    // tool.call が予約した読み直しは取り消し、下の待ちでいま始める。予約が発火するのを待たずに送ると、編集の前の差分を添えるため。
    const scheduled = pending
    pending = null
    scheduled?.cancel()
    // 予約中の読み直しがあるか、最後の書き換えのあとの一覧をまだ読めていない（書き換えの前に始まった読み込みの最中も含む）ときだけ待つ。
    // 書き換えと関係ない読み込みの最中というだけでは待たない。
    // 待つ時間はフックの持ち時間（10 秒）に数えられ、超えると ask なしで送られるため、ASK_WAIT_MS で打ち切る。
    const reloading = scheduled !== null || loadedEdits < edits
    let fresh = loadedEdits >= edits
    if (reloading || files.some(f => f.hunks === null)) {
      let timer: { cancel: () => void } | undefined
      const timeout = new Promise<void>(resolve => {
        timer = $.clock.after(ASK_WAIT_MS, resolve)
      })
      try {
        await Promise.race([scheduled === null && inFlight !== null ? inFlight : refreshOverview($), timeout])
      } finally {
        timer?.cancel()
      }
      // fresh は一覧を読む前に確かめる。読むあいだに読み直しが終わっても、stale に数えるだけで済む。
      // 逆の順にすると、古い一覧を新しいものとして扱い、ask を誤って外しうる。
      fresh = loadedEdits >= edits
      ;({ list, files } = await askedNow())
    }
    const { ready, waiting, dropped, stale } = sortAsked(list, files, fresh)
    await update($, asked, () => waiting)
    const m = await messagesOf($)
    const notes = [
      ...(stale > 0 ? [m.askStale(stale)] : []),
      ...(waiting.length > 0 ? [m.askLater(waiting.length)] : []),
      ...(dropped > 0 ? [m.askDropped(dropped)] : []),
    ]
    // 同じ mod のトーストは前のものと入れ替わることがあるので、1 つにまとめる。
    if (notes.length > 0) $.ui.toast(m.joinNotes(notes))
    if (ready.length === 0) return next(e)
    return next({ ...e, context: [...(e.context ?? []), ...ready.map(f => askText(f.path, f.hunks))] })
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: OVERVIEW_PANE }, async ($, e, next) => {
    await update($, overviewOpen, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    // Claude Code は古いツール結果から編集前の中身を消すので、変更一覧で比べる中身は書き換えの前に自分で読んでおく。
    const capture =
      e.tool === 'Edit' || e.tool === 'Write' ? await captureBefore($, e.file_path, e.tool_use_id).catch(() => null) : null
    const result = await next(e).catch(error => {
      if (capture !== null) dropCapture(capture)
      throw error
    })
    if (capture !== null) {
      const path = writtenPath(result, capture.path)
      await (path === null ? Promise.resolve(dropCapture(capture)) : saveCapture($, capture, path)).catch(() => undefined)
    }
    if (!['Edit', 'Write', 'NotebookEdit', 'Bash'].includes(e.tool)) return result
    edits += 1
    // 枠が開いていなくても、ask があれば読み直しを予約する。送信時の読み直しが ASK_WAIT_MS で終わらないと、前の差分を添えることになるため。
    if ((await read($, overviewOpen)) || (await read($, asked)).length > 0) {
      pending?.cancel()
      pending = $.clock.after(autoDelay(await $.clock.now(), readyAt), () => {
        pending = null
        refreshOverview($).catch(() => undefined)
      })
    }
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const askCount = (await read($, asked)).length
    return (
      <Box>
        <Button key="open-diff" dimColor onPress={() => toggleOverview($)}>
          {askCount > 0 ? `diff · ask ${askCount}` : 'diff'}
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { tool, output, isErrored, isExpanded } = e.props
    const source = isErrored || isExpanded === true ? null : diffSourceOf(tool, output)
    if (source === null) return next(e)

    if ((await read($, mode)) === 'original') return next(e)
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const m = await messagesOf($)
    const level = memberOf(context, e)
    const [styleId, layout] = await Promise.all([read($, style), read($, chatLayout)])
    const spec = styleSpec(styleId)
    const view = planView(source, await read($, level), spec.word !== undefined)
    if (view === null)
      return (
        <Box flexDirection="column">
          <Text dimColor>{m.tooLargeForSplit}</Text>
          {await next(e)}
        </Box>
      )

    const other = layout === 'split' ? 'unified' : 'split'
    const el = { Box, Text, Code, terminal: e.surface === 'terminal' }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text>
            <Text color="success">{view.added > 0 ? `+${view.added}` : ''}</Text>
            {view.added > 0 && view.removed > 0 ? ' ' : ''}
            <Text color="error">{view.removed > 0 ? `-${view.removed}` : ''}</Text>
          </Text>
          {view.canExpand && (
            <Button key="context" dimColor onPress={() => update($, level, () => pressTarget(view))}>
              {levelLabel(pressTarget(view), m)}
            </Button>
          )}
          <Button
            key="layout"
            dimColor
            onPress={async () => {
              await update($, chatLayout, () => other)
              await $.store.set(CHAT_LAYOUT_KEY, other)
            }}
          >
            {m.layouts[other]}
          </Button>
          {view.level < view.wanted && <Text dimColor>{m.cannotExpand}</Text>}
        </Box>
        {layout === 'split'
          ? rowsTree(el, source.filePath, view.rows, spec, view.hatch, m)
          : hunksTree(el, source.filePath, view.hunks, hunkGaps(view.hunks), spec, m)}
      </Box>
    )
  })
}
