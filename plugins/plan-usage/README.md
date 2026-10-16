# plan-usage

[日本語](README.ja.md)

Shows your Claude plan usage — the same numbers as `/usage` and the usage page on claude.ai — in three lines at the right end below the prompt:

- Current session (5-hour window)
- Current week (all models)
- Current week for a specific model, when your plan has one

Each line has a bar, the percentage used, and the reset time. A mark on the bar shows how much of the window has elapsed, and the bar turns yellow when you are ahead of that pace and red near the limit.

## Requirements

- This plugin is a mod built on function hooks. Enable them with the `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` environment variable (for example in the `env` field of `settings.json`).
- You must be signed in with a Claude subscription (OAuth). With an API key or a cloud provider such as Bedrock there is no plan limit, so nothing is shown.

## Install

```sh
claude plugin marketplace add crgstar/claude-plugins
claude plugin install plan-usage@crgstar
```

## Notes

- Usage is fetched from the same endpoint `/usage` uses (`https://api.anthropic.com/api/oauth/usage`). It is not a public API and may change or stop working without notice.
- Requests are made at most once every 5 minutes, and the result is shared between concurrent sessions. On HTTP 429 it backs off for up to an hour.
- Status messages (loading, fetch errors) are currently shown in Japanese.
