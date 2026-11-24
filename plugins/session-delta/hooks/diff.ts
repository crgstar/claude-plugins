import type { Messages } from './locale'

export type Hunk = {
  oldStart: number
  newStart: number
  lines: readonly string[]
}

export type DiffSource = {
  filePath: string
  hunks: readonly Hunk[]
  originalFile: string | null
}

export type Cell = { n: number; text: string; kind: 'same' | 'del' | 'add' }

export type Row =
  | { type: 'line'; left: Cell | null; right: Cell | null }
  | { type: 'gap'; skipped: number }

/** 前後に足す行数の段階。atom には段階の番号を持つ（JSON に Infinity を置けないため）。 */
export const CONTEXT_LEVELS = [0, 10, Number.POSITIVE_INFINITY] as const

/**
 * 見積もりの許容量。ツリーが 2 万ノードを超えると描画ごと断られ、文字は 10 万字を超えた分が切られる。
 * 見積もりに数え漏れがあってもどちらも超えないよう、上限より低く置く。
 */
export const TREE_BUDGET = { nodes: 16000, chars: 80000 } as const

export const isHunk = (v: unknown): v is Hunk =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Hunk).oldStart === 'number' &&
  typeof (v as Hunk).newStart === 'number' &&
  Array.isArray((v as Hunk).lines)

/** Edit / Write の結果から差分を取り出す。staged（保留中）・差分なし・他のツールは null。 */
export function diffSourceOf(tool: string, output: unknown): DiffSource | null {
  if (tool !== 'Edit' && tool !== 'Write') return null
  if (typeof output !== 'object' || output === null) return null
  const o = output as { filePath?: unknown; structuredPatch?: unknown; originalFile?: unknown; staged?: unknown }
  if (o.staged === true || typeof o.filePath !== 'string') return null
  if (!Array.isArray(o.structuredPatch) || o.structuredPatch.length === 0) return null
  if (!o.structuredPatch.every(isHunk)) return null
  return {
    filePath: o.filePath,
    hunks: o.structuredPatch,
    originalFile: typeof o.originalFile === 'string' ? o.originalFile : null,
  }
}

export function countChanges(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const h of hunks)
    for (const line of h.lines) {
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  return { added, removed }
}

/** 末尾の改行で生じる空要素を除いた、ファイルの行の並び。 */
export function fileLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function addedHunks(text: string): { oldStart: number; newStart: number; lines: string[] }[] {
  const lines = fileLines(text)
  return lines.length === 0 ? [] : [{ oldStart: 0, newStart: 1, lines: lines.map(l => `+${l}`) }]
}

/** 行末の \r を 1 つ外す。CRLF のファイルでは行末に \r が残り、描くと行の先頭へ戻って表示が崩れ、比べると一致しないため。 */
export const stripCr = (s: string) => (s.endsWith('\r') ? s.slice(0, -1) : s)

export const oldSpan = (h: Hunk) => h.lines.filter(l => l.startsWith(' ') || l.startsWith('-')).length
export const newSpan = (h: Hunk) => h.lines.filter(l => l.startsWith(' ') || l.startsWith('+')).length

function matchesFile(old: readonly string[], hunks: readonly Hunk[]): boolean {
  for (const h of hunks) {
    if (oldSpan(h) === 0) return false
    let at = h.oldStart - 1
    for (const line of h.lines) {
      if (!line.startsWith(' ') && !line.startsWith('-')) continue
      if (at >= old.length || stripCr(old[at]!) !== stripCr(line.slice(1))) return false
      at++
    }
  }
  return true
}

/**
 * 差分の前後に、変更前のファイルから `extra` 行ずつ文脈を足す。足した結果つながるハンクは 1 つにまとめる。
 * 差分が変更前のファイルと合わないときは null。
 */
export function expandHunks(originalFile: string, hunks: readonly Hunk[], extra: number): Hunk[] | null {
  const old = fileLines(originalFile)
  if (!matchesFile(old, hunks)) return null
  type Group = { start: number; end: number; newStart: number; lines: string[] }
  const groups: Group[] = []
  for (const h of hunks) {
    const start = h.oldStart - 1
    const end = start + oldSpan(h)
    const last = groups[groups.length - 1]
    if (last !== undefined && start - last.end <= 2 * extra) {
      for (let i = last.end; i < start; i++) last.lines.push(' ' + stripCr(old[i]!))
      last.lines.push(...h.lines)
      last.end = end
    } else {
      groups.push({ start, end, newStart: h.newStart, lines: [...h.lines] })
    }
  }
  return groups.map(g => {
    const from = Math.max(0, g.start - extra)
    const to = Math.min(old.length, g.end + extra)
    return {
      oldStart: from + 1,
      newStart: g.newStart - (g.start - from),
      lines: [...old.slice(from, g.start).map(t => ' ' + stripCr(t)), ...g.lines, ...old.slice(g.end, to).map(t => ' ' + stripCr(t))],
    }
  })
}

/**
 * ハンクの並びを、左に変更前・右に変更後を置いた行にする。削除と追加は同じ行に並べ、余った側は空ける。
 * ハンクの間と先頭、`oldTotal` が分かれば末尾にも、省いた行数の行を挟む。
 */
export function toRows(hunks: readonly Hunk[], oldTotal?: number): Row[] {
  const rows: Row[] = []
  let shownUntil = 0
  for (const h of hunks) {
    const skipped = h.oldStart - 1 - shownUntil
    if (skipped > 0) rows.push({ type: 'gap', skipped })
    let oldNo = h.oldStart
    let newNo = h.newStart
    let dels: Cell[] = []
    let adds: Cell[] = []
    const flush = () => {
      for (let i = 0; i < Math.max(dels.length, adds.length); i++)
        rows.push({ type: 'line', left: dels[i] ?? null, right: adds[i] ?? null })
      dels = []
      adds = []
    }
    for (const line of h.lines) {
      const text = stripCr(line.slice(1))
      if (line.startsWith('-')) dels.push({ n: oldNo++, text, kind: 'del' })
      else if (line.startsWith('+')) adds.push({ n: newNo++, text, kind: 'add' })
      else if (line.startsWith(' ')) {
        flush()
        rows.push({ type: 'line', left: { n: oldNo++, text, kind: 'same' }, right: { n: newNo++, text, kind: 'same' } })
      }
    }
    flush()
    shownUntil = oldNo - 1
  }
  if (oldTotal !== undefined && oldTotal > shownUntil) rows.push({ type: 'gap', skipped: oldTotal - shownUntil })
  return rows
}

/** 左右表示で片側が空の行を埋める斜線。広い列でも足りるよう長く作り、描くときに列の幅で切る。 */
export const HATCH = '╱'.repeat(160)

/**
 * 描くツリーのノード数と文字数の見積もり。要素 1 つと文字列 1 つが、それぞれ 1 ノードに数えられる。
 * 1 セルの 6 ノードは、左右表示のセルにも、1 列表示の 1 行（行の Box・番号の Text と文字列・印の Text と文字列・Code）にも足りる。
 * word のとき、削除と追加が対になるセルは、変わった部分ごとの Box と Code に分かれて 12 ノードになる。
 */
export function treeCost(
  rows: readonly Row[],
  path: string,
  { hatch = false, word = false }: { hatch?: boolean; word?: boolean } = {},
): { nodes: number; chars: number } {
  let nodes = 20
  let chars = 300
  for (const row of rows) {
    if (row.type === 'gap') {
      nodes += 2
      chars += 20
      continue
    }
    nodes += 3
    chars += 60
    const paired = word && row.left?.kind === 'del' && row.right?.kind === 'add'
    for (const cell of [row.left, row.right])
      if (cell !== null) {
        nodes += paired ? 12 : 6
        chars += cell.text.length + path.length + 30
      } else if (hatch) {
        nodes += 3
        chars += HATCH.length + 40
      }
  }
  return { nodes, chars }
}

export function fitHatch(
  rows: readonly Row[],
  path: string,
  { budget = TREE_BUDGET, word = false }: { budget?: { nodes: number; chars: number }; word?: boolean } = {},
): { hatch: boolean } | null {
  const within = (cost: { nodes: number; chars: number }) => cost.nodes <= budget.nodes && cost.chars <= budget.chars
  if (within(treeCost(rows, path, { hatch: true, word }))) return { hatch: true }
  return within(treeCost(rows, path, { word })) ? { hatch: false } : null
}

export type View = {
  rows: Row[]
  /** rows の元になったハンク（level の段階まで前後を広げたもの） */
  hunks: readonly Hunk[]
  /** 実際に描く段階。`wanted` が上限に収まらないときは下げる。 */
  level: number
  wanted: number
  canExpand: boolean
  added: number
  removed: number
  hatch: boolean
}

/** 求められた段階で描く行を決める。どの段階でも上限を超えるなら null。 */
export function planView(source: DiffSource, wanted: number, word = false): View | null {
  const old = source.originalFile
  const canExpand = old !== null && expandHunks(old, source.hunks, 0) !== null
  const top = canExpand ? Math.min(Math.max(0, Math.trunc(wanted)), CONTEXT_LEVELS.length - 1) : 0
  const counts = countChanges(source.hunks)
  for (let level = top; level >= 0; level--) {
    const hunks = level === 0 || old === null ? source.hunks : expandHunks(old, source.hunks, CONTEXT_LEVELS[level]!)
    if (hunks === null) continue
    const rows = toRows(hunks, old === null ? undefined : fileLines(old).length)
    const fit = fitHatch(rows, source.filePath, { word })
    if (fit !== null) return { rows, hunks, level, wanted: top, canExpand, ...counts, hatch: fit.hatch }
  }
  return null
}

/**
 * 前後を広げるボタンを押したあとの段階。描いた段階の次へ進み、最後の次は最初に戻る。
 * 上限で段階を下げて描いたときは、それ以上広げられないので最初に戻る。
 */
export function pressTarget(view: Pick<View, 'level' | 'wanted'>): number {
  if (view.level < view.wanted) return 0
  return (view.level + 1) % CONTEXT_LEVELS.length
}

/** ボタンの文字は、押したあとの段階を書く。 */
export function levelLabel(target: number, m: Messages): string {
  if (target === 0) return m.level.changesOnly
  const extra = CONTEXT_LEVELS[target]!
  return Number.isFinite(extra) ? m.level.around(extra) : m.level.wholeFile
}
