# claude-plugins

[English](README.md)

crgstar 作の Claude Code プラグイン集です。

| プラグイン | 説明 |
|---|---|
| [plan-usage](plugins/plan-usage) | プランの使用率を、プロンプト下の右端に 3 行で表示する |
| [session-delta](plugins/session-delta) | Edit と Write の差分を会話の中で左右に並べ、このセッション・ターン・ブランチで変わったファイルをチャットの横のペインに一覧する |

## インストール

```sh
claude plugin marketplace add crgstar/claude-plugins
claude plugin install plan-usage@crgstar
claude plugin install session-delta@crgstar
```

使うプラグインだけを入れてください。
