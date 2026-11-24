import { oldSpan, stripCr, type Hunk } from './diff'

export type UnifiedRow = { old: number | null; new: number | null; kind: 'same' | 'del' | 'add'; text: string }

export function toUnifiedRows(hunks: readonly Hunk[]): UnifiedRow[] {
  const rows: UnifiedRow[] = []
  for (const h of hunks) {
    let oldNo = h.oldStart
    let newNo = h.newStart
    for (const line of h.lines) {
      const text = stripCr(line.slice(1))
      if (line.startsWith('-')) rows.push({ old: oldNo++, new: null, kind: 'del', text })
      else if (line.startsWith('+')) rows.push({ old: null, new: newNo++, kind: 'add', text })
      else if (line.startsWith(' ')) rows.push({ old: oldNo++, new: newNo++, kind: 'same', text })
    }
  }
  return rows
}

/** 続けて並ぶ削除の塊と追加の塊を、前から順に 1 対 1 で対にし、相手の行の添字を返す。余った行は null。 */
export function pairRows(rows: readonly UnifiedRow[]): (number | null)[] {
  const partner: (number | null)[] = rows.map(() => null)
  let i = 0
  while (i < rows.length) {
    if (rows[i]!.kind !== 'del') {
      i++
      continue
    }
    const dels: number[] = []
    while (i < rows.length && rows[i]!.kind === 'del') dels.push(i++)
    const adds: number[] = []
    while (i < rows.length && rows[i]!.kind === 'add') adds.push(i++)
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      partner[dels[k]!] = adds[k]!
      partner[adds[k]!] = dels[k]!
    }
  }
  return partner
}

/** 各ハンクの前に省いた、変更前の行数。 */
export function hunkGaps(hunks: readonly Hunk[]): number[] {
  let shownUntil = 0
  return hunks.map(h => {
    const gap = h.oldStart - 1 - shownUntil
    shownUntil = h.oldStart - 1 + oldSpan(h)
    return Math.max(0, gap)
  })
}
