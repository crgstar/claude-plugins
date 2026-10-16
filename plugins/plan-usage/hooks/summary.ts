import type { RenderElement } from 'claude-code'
import { MESSAGES } from './locale.ts'
import type { Locale } from './locale.ts'
import { summaryRows } from './usage.ts'
import type { Cell, Level, UsageWindow } from './usage.ts'

// 3 行の木を組み立てるだけの関数。register から切り離しているのは、取得 (ネットワーク) 抜きで
// 固定データを描かせ、エンジンの木の検証をテストで通すため

// テーマの色名だと、この場所では薄く描かれて見分けにくかった。16 進で直接指定する。
// バーは細い線なので、くすんだ色だと暗い背景に沈む。彩度と明度を高めにする
const COLOR: Record<Level, string> = { ok: '#3ee06f', warn: '#ffd21f', over: '#ff4d5e' }
const TRACK_COLOR = '#4b4b4b'
// 目印はバーより目立たせない。塗りの上でも空きの上でも見分けられる程度の灰色
const MARK_COLOR = '#8a8a8a'
// 背景色で塗ると上下の行の背景がつながって 1 つの塊に見えるので、線の文字で描く。線は行間に隙間が残る。
// 目印の ǀ (U+01C0) は罫線の縦線より短く、線の高さの中ほどに収まる。常に 1 セル幅なのでバーがずれない
const GLYPH: Record<Cell, string> = { fill: '━', track: '━', mark: 'ǀ', markOnFill: 'ǀ' }
const BAR_WIDTH = 12

type Tag = Parameters<typeof h>[0]

export type SummaryElements = { Box: Tag; Text: Tag }

export type SummaryInput = {
  windows: UsageWindow[]
  error?: string
  nowMs: number
  locale: Locale
  // 同じ場所にもともと出ていたモード表示 (`focus` 等)。空なら行を足さない
  modes?: string
}

// 同じ種類のセルが続くところを 1 つの Text にまとめる。セルごとに Text を作ると木が無駄に大きくなる
const runs = (cells: Cell[]): { cell: Cell; length: number }[] =>
  cells.reduce<{ cell: Cell; length: number }[]>((acc, cell) => {
    const last = acc[acc.length - 1]
    if (last && last.cell === cell) last.length += 1
    else acc.push({ cell, length: 1 })
    return acc
  }, [])

export const drawSummary = ({ Box, Text }: SummaryElements, x: SummaryInput): RenderElement => {
  const rows = summaryRows(x.windows, x.nowMs, BAR_WIDTH, x.locale)
  const m = MESSAGES[x.locale]
  const lines =
    rows.length > 0
      ? rows.map((r) =>
          h(
            Text,
            { wrap: 'truncate-end' },
            h(Text, { dimColor: true }, `${r.label} `),
            ...runs(r.cells).map((run) =>
              h(Text, { color: run.cell === 'fill' || run.cell === 'markOnFill' ? COLOR[r.level] : run.cell === 'mark' ? MARK_COLOR : TRACK_COLOR }, GLYPH[run.cell].repeat(run.length)),
            ),
            h(Text, { color: r.level === 'ok' ? undefined : COLOR[r.level] }, ` ${r.percent} `),
            h(Text, { dimColor: true }, r.reset),
          ),
        )
      : [h(Text, { dimColor: true }, x.error ? m.fetchFailed(x.error) : m.loading)]
  // 取得失敗でも直前の値は出し続け、失敗したことだけ下に添える
  const note = rows.length > 0 && x.error ? [h(Text, { dimColor: true, wrap: 'truncate-end' }, m.updateFailed(x.error))] : []
  // h() の型は文字列や null も含む広い RenderNode だが、Box を渡したときは要素しか返らない
  const modes = x.modes ? [h(Text, { dimColor: true }, x.modes)] : []
  // 塊ごと右端に置かれるので、行頭は揃える。行ごとに右へ寄せるとリセット欄の長さで行頭がずれる
  return h(Box, { flexDirection: 'column', alignItems: 'flex-start' }, ...modes, ...lines, ...note) as RenderElement
}
