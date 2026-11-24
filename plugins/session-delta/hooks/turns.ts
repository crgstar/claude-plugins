import type { OverviewHunk } from '../types'
import { addedHunks, isHunk, newSpan, oldSpan } from './diff'

type ToolUseLike = { tool: string; result?: unknown; isError?: true }
type MessageLike = {
  role: 'user' | 'assistant'
  text: string
  uuid?: string
  toolUses?: readonly ToolUseLike[]
  toolResults?: readonly unknown[]
}

export type TurnFile = { path: string; hunks: OverviewHunk[] }
export type Turn = { id: string; preview: string; files: TurnFile[] }

const PREVIEW_CHARS = 30

function fileOfResult(result: unknown): TurnFile | null {
  if (typeof result !== 'object' || result === null) return null
  const r = result as { filePath?: unknown; structuredPatch?: unknown; type?: unknown; content?: unknown; staged?: unknown }
  if (typeof r.filePath !== 'string' || r.staged === true) return null
  const hunks = Array.isArray(r.structuredPatch) ? r.structuredPatch.filter(isHunk) : []
  if (hunks.length > 0) return { path: r.filePath, hunks: hunks.map(h => ({ ...h, lines: [...h.lines] })) }
  if (r.type !== 'create' || typeof r.content !== 'string') return null
  return { path: r.filePath, hunks: addedHunks(r.content) }
}

/**
 * ターンの区切りは人が打ったメッセージ（ツールの結果を除く）。
 * id は区切りのメッセージの uuid で、読む範囲の先頭がずれても同じターンを指す。uuid が無いときだけ並びの位置を使う。
 */
export function buildTurns(messages: readonly MessageLike[]): Turn[] {
  const starts = messages.flatMap((m, i) =>
    m.role === 'user' && (m.toolResults === undefined || m.toolResults.length === 0) && m.text !== '' ? [i] : [],
  )
  const turns = starts.map((start, n) => {
    const slice = messages.slice(start, starts[n + 1])
    const chars = [...slice[0]!.text.replace(/\s+/g, ' ').trim()]
    const preview = chars.length <= PREVIEW_CHARS ? chars.join('') : `${chars.slice(0, PREVIEW_CHARS - 1).join('')}…`
    const byPath = new Map<string, TurnFile>()
    for (const m of slice) {
      if (m.role !== 'assistant') continue
      for (const use of m.toolUses ?? []) {
        if ((use.tool !== 'Edit' && use.tool !== 'Write') || use.isError === true) continue
        const file = fileOfResult(use.result)
        if (file === null) continue
        const seen = byPath.get(file.path)
        byPath.set(file.path, seen === undefined ? file : { path: file.path, hunks: [...seen.hunks, ...file.hunks] })
      }
    }
    return { id: slice[0]!.uuid ?? `#${n + 1}`, preview, files: [...byPath.values()] }
  })
  return turns.filter(t => t.files.length > 0).reverse()
}

const ASK_MAX_LINES = 400
const UNSAFE_NAME = /[<>\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

/** 見えない文字や < > を含むパスは「a file」と書く。ファイル名に書かれた文が、プロンプトへの指示として読まれるのを防ぐため。 */
export function askText(path: string, hunks: readonly OverviewHunk[]): string {
  const name = UNSAFE_NAME.test(path) ? 'a file' : path
  const lines: string[] = []
  for (const h of hunks) {
    lines.push(`@@ -${h.oldStart},${oldSpan(h)} +${h.newStart},${newSpan(h)} @@`, ...h.lines)
  }
  const cut = lines.length > ASK_MAX_LINES
  return [
    `The user attached the diff of ${name} from the diff pane to this prompt:`,
    ...lines.slice(0, ASK_MAX_LINES),
    ...(cut ? [`… (${lines.length - ASK_MAX_LINES} more lines not attached)`] : []),
  ].join('\n')
}
