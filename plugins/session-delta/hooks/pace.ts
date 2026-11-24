export const SETTLE_MS = 300
export const SLOW_MS = 150
export const MAX_SLOW_WAIT_MS = 30_000
export const FIRST_UNAVAILABLE_WAIT_MS = 10_000
export const MAX_UNAVAILABLE_WAIT_MS = 60_000

export type Pace = { waitMs: number; unavailable: number }

/** 読み終えたあと、Claude の書き換えで次に読むまで空ける時間。gitMs が null は git が時間内に終わらなかったこと。 */
export function nextPace(gitMs: number | null, previous: Pace): Pace {
  if (gitMs === null) {
    const unavailable = previous.unavailable + 1
    return { waitMs: Math.min(FIRST_UNAVAILABLE_WAIT_MS * 2 ** (unavailable - 1), MAX_UNAVAILABLE_WAIT_MS), unavailable }
  }
  return { waitMs: gitMs > SLOW_MS ? Math.min(gitMs, MAX_SLOW_WAIT_MS) : 0, unavailable: 0 }
}

/** Claude の書き換えのあと、読み直しを始めるまでの時間。readyAt は前に読み終えた時刻に空ける時間を足したもの。 */
export const autoDelay = (now: number, readyAt: number) => Math.max(SETTLE_MS, readyAt - now)
