import type { DiffStyle } from '../types'

export type StyleSpec = {
  id: DiffStyle
  /** 変更行の背景。キーの無い側は塗らない。 */
  line: { del?: string; add?: string }
  /** 行番号の後ろに色付きの + / - を置く */
  marker: boolean
  /** 削除と追加が対になる行で、変わった部分だけを塗る色。 */
  word?: { del: string; add: string }
}

// テーマ `dark-ansi` では差分の色が端末の ANSI 色になり、控えめな色のキーでも濃く出る。
// そのため hex を直接書く。背景より暗い色は灰色に沈む。
/** 端末の背景。画面から測った値。 */
export const TERMINAL_BG = '#282828'
const GREEN = '#2ea043'
const RED = '#f85149'

/** 色は #rrggbb 形式のみ。alpha は 0〜1。 */
export function blend(base: string, color: string, alpha: number): string {
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const [b, c] = [rgb(base), rgb(color)]
  return `#${b.map((v, i) => Math.round(v * (1 - alpha) + c[i]! * alpha).toString(16).padStart(2, '0')).join('')}`
}

const tint = (alpha: number) => ({ del: blend(TERMINAL_BG, RED, alpha), add: blend(TERMINAL_BG, GREEN, alpha) })

export const HATCH_COLOR = blend(TERMINAL_BG, '#ffffff', 0.1)

export const STYLES: readonly StyleSpec[] = [
  { id: 'soft', line: tint(0.15), marker: false },
  { id: 'faint', line: tint(0.08), marker: false },
  {
    id: 'word',
    line: tint(0.15),
    marker: false,
    word: tint(0.4),
  },
  { id: 'marker', line: {}, marker: true },
  { id: 'theme', line: { del: 'diffRemovedDimmed', add: 'diffAddedDimmed' }, marker: false },
]

export const DEFAULT_STYLE: DiffStyle = 'soft'

export const isStyle = (v: unknown): v is DiffStyle => STYLES.some(s => s.id === v)

export const styleSpec = (id: DiffStyle): StyleSpec => STYLES.find(s => s.id === id) ?? STYLES[0]!

export type Span = { text: string; changed: boolean }

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/

const isBoundary = (s: string): ((at: number) => boolean) => {
  if (PRINTABLE_ASCII.test(s)) return () => true
  const segments = graphemes.segment(s)
  return i => i >= s.length || segments.containing(i)!.index === i
}

const isWord = (c: string | undefined) => c !== undefined && /[\w$]/.test(c)

/** `prefix` の終わりが文字列の中なら開きの引用符の位置と種類、`//` のコメントの中ならその位置。どちらでもなければ null。 */
export function openContext(prefix: string): { at: number; quote: string | null } | null {
  let quote: string | null = null
  let at = -1
  for (let i = 0; i < prefix.length; i++) {
    const c = prefix[i]!
    if (quote !== null) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      at = i
    } else if (c === '/' && prefix[i + 1] === '/') return { at: i, quote: null }
  }
  return quote === null ? null : { at, quote }
}

function closingAt(suffix: string, quote: string): number {
  for (let i = 0; i < suffix.length; i++) {
    if (suffix[i] === '\\') i++
    else if (suffix[i] === quote) return i
  }
  return -1
}

/**
 * 2 つの行に共通する先頭と末尾を除いた残りを、変わった部分とする。
 * 変わった部分は別の Code 要素になり、構文の色が部分ごとに独立して付くので、語・文字列・`//` のコメントの途中で切ると色がずれる。
 * そのため境界をこれらの切れ目まで広げる。
 */
export function wordSpans(before: string, after: string): { before: Span[]; after: Span[] } {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++
  // 一致が書記素の途中（サロゲートペア・ZWJ・結合文字の前）で終わると、変わった部分が結合文字だけになって 0 列と数えられ、見えなくなる。
  // そのため両方の行の書記素の切れ目まで戻す。語・文字列の切れ目まで広げたあとの境界も書記素の途中に来うるので、もう一度戻す。
  const [beforeAt, afterAt] = [isBoundary(before), isBoundary(after)]
  const snap = () => {
    while (head > 0 && !(beforeAt(head) && afterAt(head))) head--
    while (tail > 0 && !(beforeAt(before.length - tail) && afterAt(after.length - tail))) tail--
  }
  snap()
  if (isWord(before[head]) || isWord(after[head])) while (head > 0 && isWord(before[head - 1])) head--
  if (isWord(before[before.length - tail - 1]) || isWord(after[after.length - tail - 1]))
    while (tail > 0 && isWord(before[before.length - tail])) tail--
  const open = openContext(before.slice(0, head))
  if (open !== null) {
    head = open.at
    const suffix = before.slice(before.length - tail)
    const close = open.quote === null ? -1 : closingAt(suffix, open.quote)
    tail = close < 0 ? 0 : suffix.length - close - 1
  }
  snap()
  const split = (s: string): Span[] =>
    [
      { text: s.slice(0, head), changed: false },
      { text: s.slice(head, s.length - tail), changed: true },
      { text: s.slice(s.length - tail), changed: false },
    ].filter(span => span.text !== '')
  return { before: split(before), after: split(after) }
}

// 書記素の全文字が結合文字・書式文字・制御文字のときだけ 0 列。先頭の文字だけで判定すると、後ろの文字と 1 つの書記素になる前置きの書式文字（U+0600 等）を含む書記素全体が 0 列になる。
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]+$/u
// tsconfig は Claude Code が配るものを継承していて target を変えられず、ES2024 より前なので、v フラグの正規表現リテラルが型検査を通らない。
const EMOJI = new RegExp('^\\p{RGI_Emoji}$', 'v')

const isWide = (code: number) =>
  (code >= 0x1100 && code <= 0x115f) ||
  (code >= 0x2e80 && code <= 0xa4cf) ||
  (code >= 0xac00 && code <= 0xd7a3) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xfe30 && code <= 0xfe4f) ||
  (code >= 0xff00 && code <= 0xff60) ||
  (code >= 0xffe0 && code <= 0xffe6) ||
  (code >= 0x20000 && code <= 0x3fffd)

/** 端末で使う列数。全角と絵文字は 2 列、結合文字と制御文字は 0 列。 */
export function cellWidth(text: string): number {
  if (PRINTABLE_ASCII.test(text)) return text.length
  let width = 0
  for (const { segment } of graphemes.segment(text)) {
    if (ZERO_WIDTH.test(segment)) continue
    width += EMOJI.test(segment) || isWide(segment.codePointAt(0)!) ? 2 : 1
  }
  return width
}

export const expandTabs = (text: string) => text.replace(/\t/g, '    ')

export function numberWidth(numbers: readonly number[]): number {
  return Math.max(1, ...numbers.map(n => String(n).length))
}
