import type { DiffBase, DiffStyle, NoiseKind, PaneLayout } from '../types'

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
  command: {
    description: string
    badArgs: string
    openedLook: string
    openedOverview: string
    split: string
    original: string
  }
  lookTitle: string
  styles: Record<DiffStyle, string>
  applied: string
  apply: string
  overviewTitle: string
  bases: Record<DiffBase, string>
  turn: (preview: string) => string
  badges: Record<NoiseKind, string>
  /** 押すと切り替わる先の表示の名前 */
  layouts: Record<PaneLayout, string>
  collapseAll: string
  expandAll: string
  refresh: string
  loading: string
  newer: string
  older: string
  turnSpan: (from: number, to: number, count: number) => string
  noChanges: string
  earlier: (count: number) => string
  skippedLines: (count: number) => string
  overBudget: string
  /** ask を押したファイルの差分を送信までに読めず（読み込み中か、一覧が編集の前のもの）、次の送信に回したとき */
  askLater: (count: number) => string
  /** 編集のあとの読み直しが送信までに終わらないか git を使えずに終わり、前に読んだ差分を添えたとき */
  askStale: (count: number) => string
  /** ask を押したファイルが一覧から消えたか差分を出せなくなり、送信時に外したとき */
  askDropped: (count: number) => string
  /** 選んでいたターンが会話の記録から消え、ターンを選ぶ前の範囲に戻したとき。引数は戻した範囲の表示名 */
  turnGone: (range: string) => string
  note: {
    binary: string
    noContentChange: string
    renameOnly: string
    tooLarge: string
    unavailable: string
    emptyFile: string
    deleted: string
  }
  gitFailed: (stderr: string) => string
  tooManyChanged: (count: number, isMore: boolean) => string
  untrackedOmitted: (count: number) => string
  joinNotes: (notes: readonly string[]) => string
  gitSlow: (seconds: number) => string
  loadFailed: (error: string) => string
  otherGroup: string
  scratchpadGroup: string
  tooLargeForSplit: string
  cannotExpand: string
  level: { changesOnly: string; around: (lines: number) => string; wholeFile: string }
}

export type NoteKey = keyof Messages['note']

const lines = (n: number) => (n === 1 ? '1 line' : `${n} lines`)

export const MESSAGES: Record<Locale, Messages> = {
  ja: {
    command: {
      description: '変更一覧を開く。on / off で会話の差分の左右表示を切り替え、colors で色の案を開く',
      badArgs: '/session-delta の引数は on・off・colors のどれか（省略すると変更一覧を開く）',
      openedLook: '差分の色を開きました',
      openedOverview: '変更一覧を開きました',
      split: '差分を左右に並べて表示します',
      original: '差分を標準の表示に戻しました',
    },
    lookTitle: '差分の色',
    styles: {
      soft: '淡色の背景',
      faint: 'ごく淡色の背景',
      word: '淡色の背景 + 変更箇所を強調',
      marker: '背景なし（+/- 記号）',
      theme: 'テーマ色',
    },
    applied: '適用中',
    apply: '適用',
    overviewTitle: '変更一覧',
    bases: { session: 'このセッション', branch: 'ブランチ全体' },
    turn: preview => `「${preview}」`,
    badges: { test: 'テスト', generated: '生成' },
    layouts: { unified: '1 列', split: '左右' },
    collapseAll: 'すべて折りたたむ',
    expandAll: 'すべて展開',
    refresh: '更新',
    loading: '読み込み中…',
    newer: '‹ 新しい',
    older: '古い ›',
    turnSpan: (from, to, count) => `ターン ${from}–${to} / ${count}`,
    noChanges: '変更はありません',
    earlier: count => `セッション開始前の変更（${count} 件）`,
    skippedLines: count => `${count} 行`,
    overBudget: '（表示できる量を超えたため省略。ほかのファイルを折りたたむと表示）',
    askLater: count => `ask の ${count} 件は差分をまだ読めていないため、次の送信で添えます`,
    askDropped: count => `ask の ${count} 件は差分を添えられないため外しました`,
    askStale: count => `ask の ${count} 件は編集のあとの差分を読めず、編集の前に読んだ差分を添えました`,
    turnGone: range => `選んでいたターンが会話の記録に無くなったため、範囲を「${range}」に戻しました`,
    note: {
      binary: 'バイナリ',
      noContentChange: '中身の変更なし',
      renameOnly: '名前の変更のみ',
      tooLarge: '大きいため省略',
      unavailable: '比較不可',
      emptyFile: '空のファイル',
      deleted: '削除',
    },
    gitFailed: stderr => `git diff が失敗しました: ${stderr}`,
    tooManyChanged: (count, isMore) => `変更されたファイルが ${count} 件${isMore ? '以上' : ''}あるため、一覧を省略しました`,
    untrackedOmitted: count => `未追跡のファイルが多いため、${count} 件を省略しました`,
    joinNotes: notes => notes.join('。'),
    gitSlow: seconds => `git が時間内に終わらなかったため、前の一覧を出しています（${seconds} 秒あけて読み直します）`,
    loadFailed: error => `読み込めなかった: ${error}`,
    otherGroup: 'その他',
    scratchpadGroup: '一時フォルダ（このセッション）',
    tooLargeForSplit: '差分が大きいため標準表示',
    cannotExpand: '（これ以上は広げられません）',
    level: { changesOnly: '変更箇所のみ', around: n => `前後 +${n} 行`, wholeFile: 'ファイル全体' },
  },
  en: {
    command: {
      description: 'Open the change list. on / off switches side-by-side diffs in the conversation, colors opens the color options',
      badArgs: '/session-delta takes on, off or colors (no argument opens the change list)',
      openedLook: 'Opened the diff colors',
      openedOverview: 'Opened the change list',
      split: 'Showing diffs side by side',
      original: 'Back to the standard diff view',
    },
    lookTitle: 'Diff colors',
    styles: {
      soft: 'Soft background',
      faint: 'Faint background',
      word: 'Soft background + highlighted changes',
      marker: 'No background (+/- markers)',
      theme: 'Theme colors',
    },
    applied: 'In use',
    apply: 'Apply',
    overviewTitle: 'Changes',
    bases: { session: 'This session', branch: 'Whole branch' },
    turn: preview => `“${preview}”`,
    badges: { test: 'test', generated: 'generated' },
    layouts: { unified: 'Unified', split: 'Split' },
    collapseAll: 'Collapse all',
    expandAll: 'Expand all',
    refresh: 'Refresh',
    loading: 'Loading…',
    newer: '‹ Newer',
    older: 'Older ›',
    turnSpan: (from, to, count) => `Turns ${from}–${to} of ${count}`,
    noChanges: 'No changes',
    earlier: count => `Changed before this session (${count})`,
    skippedLines: lines,
    overBudget: '(Too much to show. Collapse other files to show this one.)',
    askLater: count =>
      count === 1
        ? 'An asked diff has not been read yet, so it will be attached to your next prompt'
        : `${count} asked diffs have not been read yet, so they will be attached to your next prompt`,
    askDropped: count =>
      count === 1
        ? 'An asked diff can no longer be attached, so its ask was cleared'
        : `${count} asked diffs can no longer be attached, so their asks were cleared`,
    askStale: count =>
      count === 1
        ? 'The diff of an asked file could not be read again after the edits, so the one read before them was attached'
        : `The diffs of ${count} asked files could not be read again after the edits, so the ones read before them were attached`,
    turnGone: range => `The selected turn is no longer in the conversation, so the range is back to “${range}”`,
    note: {
      binary: 'binary',
      noContentChange: 'no content change',
      renameOnly: 'renamed only',
      tooLarge: 'too large to show',
      unavailable: 'diff unavailable',
      emptyFile: 'empty file',
      deleted: 'deleted',
    },
    gitFailed: stderr => `git diff failed: ${stderr}`,
    tooManyChanged: (count, isMore) => `${count}${isMore ? '+' : ''} files changed, so the list is omitted`,
    untrackedOmitted: count => `Too many untracked files; ${count} omitted`,
    joinNotes: notes => notes.join('. '),
    gitSlow: seconds => `git did not finish in time, so the previous list is shown (retrying in ${seconds}s)`,
    loadFailed: error => `Could not load: ${error}`,
    otherGroup: 'Other',
    scratchpadGroup: 'Scratchpad (this session)',
    tooLargeForSplit: 'Diff too large, so the standard view is shown',
    cannotExpand: '(Cannot expand further)',
    level: { changesOnly: 'Changes only', around: n => `+${lines(n)} of context`, wholeFile: 'Whole file' },
  },
}
