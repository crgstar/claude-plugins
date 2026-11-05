import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'
import { pickLocale, posixLocaleOf } from './locale.ts'
import type { Locale } from './locale.ts'
import { isReplyTextRow, showsUsageButton } from './placement.ts'
import { decide, nextBackoff, overlayHeaderLimits, retryAfterMs } from './policy.ts'
import type { Backoff, Cached, HeaderLimit } from './policy.ts'
import { drawSummary } from './summary.ts'
import type { SummaryInput } from './summary.ts'
import { parseUsage } from './usage.ts'

// /usage と claude.ai の使用量画面が読んでいるのと同じエンドポイント。モデル別の週次枠はここにしか無い
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
// 共有結果を読み直す間隔。API を呼ぶかどうかは decide が決めるので、ここを短くしても呼ぶ回数は増えない
const TICK_MS = 60_000
// $.store はセッションをまたいで残る。並行するセッションが同じ結果と待ち時間を見るために置く
const CACHE_KEY = 'cached'
const BACKOFF_KEY = 'backoff'

let cached: Cached | undefined
let lastError: string | undefined
// 直前の API 応答ヘッダに載っていた 5 時間枠・週次枠。セッション最初のリクエストまでは空
let headerLimits: readonly HeaderLimit[] = []
let nowMs = 0
let inFlight = false
// セッション開始時に決める。決まるまでの描画は英語にしておく
let locale: Locale = 'en'

// 開閉ボタンの描画が読む値。$.state に置くと、書き換えたときに読んでいる応答だけが描き直され、プラグインの再読み込みでも消えない
const lastReplyId = atom({ plugin: 'plan-usage', key: 'lastReplyId' } as const, null)
const isOpen = atom({ plugin: 'plan-usage', key: 'isOpen' } as const, false)

// 最初の取得が済むまでと、API キー・Bedrock 等で使用量が無いときは、どこにも何も出さない
const hasNothingToShow = (): boolean => !cached && lastError === undefined

const summaryInput = (): SummaryInput => ({
  windows: cached ? overlayHeaderLimits(cached.windows, headerLimits) : [],
  error: lastError,
  nowMs,
  locale,
})

const isCached = (v: unknown): v is Cached =>
  typeof v === 'object' && v !== null && Array.isArray((v as Cached).windows) && typeof (v as Cached).fetchedAtMs === 'number'

const isBackoff = (v: unknown): v is Backoff =>
  typeof v === 'object' && v !== null && typeof (v as Backoff).retryAtMs === 'number' && typeof (v as Backoff).lastDelayMs === 'number'

const refresh = async ($: EngineInterface): Promise<void> => {
  if (inFlight) return
  inFlight = true
  try {
    nowMs = await $.clock.now()
    const stored = await $.store.get(CACHE_KEY)
    cached = isCached(stored) ? stored : cached
    const storedBackoff = await $.store.get(BACKOFF_KEY)
    const backoff = isBackoff(storedBackoff) ? storedBackoff : undefined

    const decision = decide(cached, backoff, nowMs)
    // 新しい共有結果がある = どこかのセッションが取得に成功している。こちらの失敗表示は古い
    if (decision === 'use-cache') lastError = undefined
    if (decision !== 'fetch') return

    const auth = await $.session.authorize()
    // API キー・Bedrock 等ではプランの上限が無い。何も出さない
    if (!auth || auth.kind !== 'bearer') {
      cached = undefined
      return
    }
    const res = await $.http.fetch(USAGE_URL, {
      auth: auth.handle,
      headers: { 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' },
    })
    const windows = res.ok ? parseUsage(res.text) : null
    if (windows) {
      cached = { windows, fetchedAtMs: nowMs }
      lastError = undefined
      await $.store.set(CACHE_KEY, cached)
      await $.store.delete(BACKOFF_KEY)
      return
    }
    lastError = res.ok ? 'unexpected response' : `HTTP ${res.status}`
    if (res.status === 429) {
      await $.store.set(BACKOFF_KEY, nextBackoff(backoff, retryAfterMs(res.headers['retry-after'], nowMs), nowMs))
    }
  } catch (err) {
    lastError = String(err)
  } finally {
    inFlight = false
    $.ui.invalidate('ui.render')
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    // 言語が決められなくても使用率の取得は止めない。決められなければ既定の英語のまま描く
    try {
      const [settings, lcAll, lcMessages, lang] = await Promise.all([
        $.settings.read() as Promise<{ language?: unknown }>,
        $.env.get('LC_ALL'),
        $.env.get('LC_MESSAGES'),
        $.env.get('LANG'),
      ])
      locale = pickLocale(settings.language, posixLocaleOf(lcAll, lcMessages, lang))
    } catch {}
    $.clock.every(TICK_MS, () => {
      void refresh($)
    })
    headerLimits = (await $.session.usage()).rateLimits
    void refresh($)
    return next(e)
  })

  // ヘッダ由来の値は通信なしで届くので、動いたらすぐ描き直す
  on('session.measure', ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      headerLimits = e.rateLimits
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // プロンプト下の行の右端 (モード表示の場所)。ステータスラインの行の右側に並ぶので、新しく行を取らずに 3 行を出せる
  on('ui.render', { component: 'SessionMode' }, ($, e, next) => {
    if (hasNothingToShow()) return next(e)
    return drawSummary($.ui.resolve(e), {
      ...summaryInput(),
      // 元のモード表示は engine の目印として返り、木に入れ子にできないので、文字列で描き直す
      modes: e.props.modes.join(' & '),
    })
  })

  // 応答の本文の行が会話に加わるたびに、開閉ボタンの付け先をその行へ移す。開いていたらそのまま開いて移る
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (isReplyTextRow(e)) await update($, lastReplyId, () => e.uuid)
    return stored
  })

  // スマホと VS Code にはプロンプト下の右端が無いので、最後の応答の下に開閉ボタンを置く。
  // 開閉は描画だけの切り替えで、モデルに渡る会話は変わらない
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!showsUsageButton(e.surface) || hasNothingToShow()) return next(e)
    if (e.requestId !== (await read($, lastReplyId))) return next(e)
    const open = await read($, isOpen)
    const elements = $.ui.resolve(e)
    const { Box, Button } = elements
    return h(
      Box,
      { flexDirection: 'column' },
      await next(e),
      h(Button, { key: 'usage', label: '📊', onPress: () => update($, isOpen, (was) => !was) }),
      ...(open ? [drawSummary(elements, summaryInput())] : []),
    ) as RenderElement
  })
}
