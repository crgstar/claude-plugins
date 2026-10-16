import type { UsageWindow } from './usage.ts'

// 使用量 API を「いつ呼ぶか」の判断。API は呼びすぎると 429 を返すので、
// セッションをまたいで共有する取得結果と待ち時間を見て、呼ぶかどうかを決める

export const POLL_MS = 5 * 60_000
const MIN_BACKOFF_MS = 5 * 60_000
const MAX_BACKOFF_MS = 60 * 60_000

export type Cached = { windows: UsageWindow[]; fetchedAtMs: number }

// セッションをまたいで残す待ち状態。retryAtMs までは誰も呼ばない
export type Backoff = { retryAtMs: number; lastDelayMs: number }

export type Decision = 'use-cache' | 'wait' | 'fetch'

export const decide = (cached: Cached | undefined, backoff: Backoff | undefined, nowMs: number): Decision => {
  if (backoff && nowMs < backoff.retryAtMs) return 'wait'
  if (cached && nowMs - cached.fetchedAtMs < POLL_MS) return 'use-cache'
  return 'fetch'
}

// Retry-After は秒数と HTTP 日付の 2 形式がある。読めなければ undefined
export const retryAfterMs = (header: string | undefined, nowMs: number): number | undefined => {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const at = Date.parse(header)
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs)
}

// 429 を受けたあとの待ち。指定があればそれに従い、無ければ前回の倍 (5 分〜60 分) にする
export const nextBackoff = (prev: Backoff | undefined, retryAfter: number | undefined, nowMs: number): Backoff => {
  const doubled = Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, (prev?.lastDelayMs ?? 0) * 2))
  const delay = retryAfter ?? doubled
  return { retryAtMs: nowMs + delay, lastDelayMs: delay }
}

export type HeaderLimit = { kind: string; percentUsed: number; resetsAt?: string }

// API 応答ヘッダ由来の 5 時間枠・週次枠で、取得済みの値を上書きする。ヘッダは毎リクエスト届き
// 追加の通信が要らないので、使用量 API の取得間隔のあいだも Session / Week は新しく保てる。
// モデル別の週次枠はヘッダに無いので、取得した値のまま
export const overlayHeaderLimits = (windows: UsageWindow[], limits: readonly HeaderLimit[]): UsageWindow[] => {
  const byShort: Record<string, string> = { five_hour: 'Session', seven_day: 'Week' }
  return windows.map((w) => {
    const hit = limits.find((l) => byShort[l.kind] === w.short)
    // 公式表示と同じく整数に切り捨てる
    return hit ? { ...w, percent: Math.floor(hit.percentUsed), resetsAt: hit.resetsAt ?? w.resetsAt } : w
  })
}
