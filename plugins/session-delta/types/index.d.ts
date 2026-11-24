/** 会話の中の Edit / Write の差分を、左右に並べて描くか、エンジンの元の表示に任せるか。 */
export type DiffMode = 'split' | 'original'

/** 左右表示の色の付け方。中身は hooks/look.ts の STYLES。 */
export type DiffStyle = 'soft' | 'faint' | 'word' | 'marker' | 'theme'

export type PaneLayout = 'unified' | 'split'

export type NoiseKind = 'test' | 'generated'

export type OverviewHunk = { oldStart: number; newStart: number; lines: string[] }

export type OverviewFile = {
  path: string
  /** 名前を変えたファイルの元の path */
  oldPath?: string
  display: string
  added: number
  removed: number
  /** null は差分があるが、まだ読んでいないこと（展開か ask で読む）。空の配列は本文が無いこと（理由は note）。 */
  hunks: OverviewHunk[] | null
  noise?: NoiseKind
  /** 本文を出せない理由や、未追跡などの補足 */
  note?: string
}

/** session は HEAD との差、branch は既定ブランチとの merge-base との差。 */
export type DiffBase = 'session' | 'branch'

export type OverviewGroup = {
  title: string
  files: OverviewFile[]
  /** HEAD との差があり、更新時刻がセッション開始より前のファイル。base が session のときだけ入る。 */
  earlier?: OverviewFile[]
}

export type Overview = {
  groups: OverviewGroup[]
  /** ファイルを変えたターンの一覧（新しい順）。id はターンの最初のメッセージの uuid。 */
  turns: { id: string; preview: string }[]
  note?: string
}

declare module 'claude-code' {
  interface PluginState {
    'session-delta': {
      mode: DiffMode
      style: DiffStyle
      paneLayout: PaneLayout
      /** 会話の中の差分を mod が描くとき（mode が split）の、左右か 1 列か。 */
      chatLayout: PaneLayout
      /** tool_use_id（Edit / Write の結果 1 件）ごとの、前後に足す行数の段階の番号（hooks/diff.ts の CONTEXT_LEVELS の添字）。 */
      context: StateFamily<number>
      overview: Shaped<Overview>
      /** 「変更一覧」で展開しているファイルの path。 */
      expanded: Shaped<string[]>
      rangeMenuOpen: boolean
      /** 範囲の選択肢で表示しているターンのページ（0 が最新） */
      turnPage: number
      overviewOpen: boolean
      base: DiffBase
      /** 「セッション開始前の変更」の行を展開しているか */
      earlierOpen: boolean
      /** 「ask」で次のメッセージに付ける path */
      asked: Shaped<string[]>
      /** 空文字はいまの変更。それ以外は turns の id で、そのターンの Edit / Write。 */
      turn: string
      loading: boolean
    }
  }
}
