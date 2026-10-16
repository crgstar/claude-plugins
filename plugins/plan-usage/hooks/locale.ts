// 表示言語の判定と、言語ごとの文言。判定を register から切り離しているのは、
// 設定と環境変数の組み合わせをテストで網羅するため

export type Locale = 'ja' | 'en'

// 言語コードの `ja` は後ろに英字が続かないものだけ。前方一致だと Javanese や jam_JM (ジャマイカ・クレオール語) まで拾う
const isJaCode = (s: string): boolean => /^ja(?![a-z])/i.test(s)

// Claude Code の `language` 設定を OS のロケールより優先する。返答の言語としてユーザーが明示的に選んだ値なので、
// 端末のロケールが英語のままの人でも日本語で揃えられる。日本語以外が書かれていたら、用意のある英語に倒す
export const pickLocale = (language: unknown, posixLocale: string | undefined): Locale => {
  if (typeof language === 'string' && language.trim() !== '') {
    return /^(japanese|日本語)/i.test(language.trim()) || isJaCode(language.trim()) ? 'ja' : 'en'
  }
  return posixLocale && isJaCode(posixLocale) ? 'ja' : 'en'
}

// POSIX の優先順 (LC_ALL > LC_MESSAGES > LANG)。空文字は未設定と同じに扱う
export const posixLocaleOf = (lcAll: string | undefined, lcMessages: string | undefined, lang: string | undefined): string | undefined =>
  lcAll || lcMessages || lang || undefined

export type Messages = {
  loading: string
  fetchFailed: (error: string) => string
  updateFailed: (error: string) => string
  // 月は 0 始まり、曜日は 0 が日曜 (Date の getMonth / getDay のまま)
  day: (month: number, date: number, weekday: number) => string
}

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土']
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const MESSAGES: Record<Locale, Messages> = {
  ja: {
    loading: '取得中…',
    fetchFailed: (e) => `取得失敗: ${e}`,
    updateFailed: (e) => `更新失敗: ${e}`,
    day: (m, d, w) => `${m + 1}/${d}(${WEEKDAYS_JA[w]})`,
  },
  en: {
    loading: 'Loading…',
    fetchFailed: (e) => `Failed to fetch: ${e}`,
    updateFailed: (e) => `Failed to update: ${e}`,
    day: (m, d, w) => `${MONTHS_EN[m]} ${d} (${WEEKDAYS_EN[w]})`,
  },
}
