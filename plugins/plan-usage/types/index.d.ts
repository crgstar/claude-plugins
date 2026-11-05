declare module 'claude-code' {
  interface PluginState {
    'plan-usage': {
      // 開閉ボタンを付ける応答の行の uuid。応答がまだ無ければ null
      lastReplyId: string | null
      // 使用量を開いているか。画面ごとには分けない
      isOpen: boolean
    }
  }
}
