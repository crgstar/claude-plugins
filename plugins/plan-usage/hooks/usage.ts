// claude.ai の使用量画面・/usage と同じデータ (/api/oauth/usage) を、帯に描く形へ整える純粋関数群。
// 応答の limits[] がそのまま公式の「Current session / Current week (all models) / Current week (<モデル>)」
// の並びになっているので、旧来の five_hour / seven_day は limits[] が無い応答の保険としてだけ読む

export type UsageWindow = {
  title: string
  short: string
  percent: number
  resetsAt?: string
  // 枠の長さ。リセット時刻と合わせて「枠の時間がどれだけ過ぎたか」を出すのに使う
  periodMs: number
}

const FIVE_HOURS = 5 * 3_600_000
const SEVEN_DAYS = 7 * 86_400_000

type Limit = {
  kind?: string
  percent?: number
  resets_at?: string | null
  scope?: { model?: { display_name?: string | null } | null } | null
}

type Legacy = { utilization?: number | null; resets_at?: string | null } | null | undefined

const fromLimit = (l: Limit): UsageWindow | null => {
  if (typeof l.percent !== 'number') return null
  const resetsAt = l.resets_at ?? undefined
  if (l.kind === 'session') return { title: 'Current session', short: 'Session', percent: l.percent, resetsAt, periodMs: FIVE_HOURS }
  if (l.kind === 'weekly_all') return { title: 'Current week (all models)', short: 'Week', percent: l.percent, resetsAt, periodMs: SEVEN_DAYS }
  const model = l.scope?.model?.display_name
  if (l.kind === 'weekly_scoped' && model) return { title: `Current week (${model})`, short: model, percent: l.percent, resetsAt, periodMs: SEVEN_DAYS }
  return null
}

const fromLegacy = (title: string, short: string, periodMs: number, w: Legacy): UsageWindow | null =>
  w && typeof w.utilization === 'number'
    ? // 公式の文字表示が Math.floor で切り捨てているのに揃える
      { title, short, percent: Math.floor(w.utilization), resetsAt: w.resets_at ?? undefined, periodMs }
    : null

// 解釈できない応答は null。呼び出し側で「取得失敗」と区別して扱うため、空配列とは分ける
export const parseUsage = (text: string): UsageWindow[] | null => {
  let body: { limits?: Limit[]; five_hour?: Legacy; seven_day?: Legacy; seven_day_sonnet?: Legacy }
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  if (Array.isArray(body.limits)) {
    return body.limits.map(fromLimit).filter((w): w is UsageWindow => w !== null)
  }
  return [
    fromLegacy('Current session', 'Session', FIVE_HOURS, body.five_hour),
    fromLegacy('Current week (all models)', 'Week', SEVEN_DAYS, body.seven_day),
    fromLegacy('Current week (Sonnet only)', 'Sonnet', SEVEN_DAYS, body.seven_day_sonnet),
  ].filter((w): w is UsageWindow => w !== null)
}

export type Level = 'ok' | 'warn' | 'over'

// 枠の時間のうち過ぎた割合 (0〜1)。リセット時刻が無い・読めないときは undefined
export const elapsedRatio = (w: UsageWindow, nowMs: number): number | undefined => {
  if (!w.resetsAt) return undefined
  const resetMs = new Date(w.resetsAt).getTime()
  if (Number.isNaN(resetMs)) return undefined
  return Math.min(1, Math.max(0, 1 - (resetMs - nowMs) / w.periodMs))
}

// 色は使用率そのものではなくペースで決める。同じ 62% でも、枠の終わり際なら余裕があり、
// 始まったばかりなら上限に届く。ペースより少し先に出ただけで黄色にすると枠の序盤がうるさいので、
// 5 ポイントの遊びを持たせる
const PACE_SLACK = 5

export const paceLevel = (percent: number, elapsed: number | undefined): Level => {
  if (percent >= 95) return 'over'
  if (elapsed !== undefined && percent - elapsed * 100 >= PACE_SLACK) return 'warn'
  return 'ok'
}

// mark は「枠の時間がここまで過ぎた」位置。塗りの上に重なったら markOnFill にして、塗りの色で描く。
// 目印で塗りを上書きすると、枠の序盤 (目印が先頭) に使用量が 1 セルぶん消えて 0% と見分けが付かない
export type Cell = 'fill' | 'track' | 'mark' | 'markOnFill'

// バーを 1 セルずつ
export const barCells = (percent: number, elapsed: number | undefined, width: number): Cell[] => {
  const p = Math.min(100, Math.max(0, percent))
  // 0% より上なら最低 1 セル塗る。0 セルだと未使用と区別が付かない
  const filled = p > 0 ? Math.max(1, Math.round((p / 100) * width)) : 0
  const cells: Cell[] = Array.from({ length: width }, (_, i) => (i < filled ? 'fill' : 'track'))
  if (elapsed !== undefined) {
    const at = Math.min(width - 1, Math.floor(elapsed * width))
    cells[at] = cells[at] === 'fill' ? 'markOnFill' : 'mark'
  }
  return cells
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

// 同じ日なら「17:09」、違う日なら「10/20(火)」
export const formatResetShort = (iso: string, nowMs: number): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date(nowMs)
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
}

// 右端に常時出す 3 行の 1 行分。列を揃えるため、ラベルと使用率は全行の最大幅で詰める
export type SummaryRow = { label: string; cells: Cell[]; percent: string; reset: string; level: Level }

export const summaryRows = (windows: UsageWindow[], nowMs: number, barWidth: number): SummaryRow[] => {
  const labelWidth = Math.max(0, ...windows.map((w) => w.short.length))
  return windows.map((w) => {
    const elapsed = elapsedRatio(w, nowMs)
    return {
      label: w.short.padEnd(labelWidth),
      cells: barCells(w.percent, elapsed, barWidth),
      percent: `${w.percent}%`.padStart(4),
      reset: w.resetsAt ? formatResetShort(w.resetsAt, nowMs) : '',
      level: paceLevel(w.percent, elapsed),
    }
  })
}
