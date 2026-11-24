# claude-plugins

[日本語](README.ja.md)

Claude Code plugins by crgstar.

| Plugin | Description |
|---|---|
| [plan-usage](plugins/plan-usage) | Shows your Claude plan usage in three lines at the right end below the prompt |
| [session-delta](plugins/session-delta) | Shows Edit and Write diffs side by side in the conversation, and lists what changed in this session, in one turn, or on the branch in a pane beside the chat |

## Install

```sh
claude plugin marketplace add crgstar/claude-plugins
claude plugin install plan-usage@crgstar
claude plugin install session-delta@crgstar
```

Install only the plugins you want.
