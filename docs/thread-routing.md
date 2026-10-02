# Thread rope-in + staff routing (draft)

**Branch:** `loop/franbird-thread-routing`  
**Independent of PR #6** — includes a minimal `SLACK_EXTRA_CHANNELS` env merge so new channels stay config-only without needing the deepen PR.

## Live-ready

- Allowlist still code-owned (`CHANNEL_ALLOWLIST`); extras via `SLACK_EXTRA_CHANNELS=C…:name,…`
- `@Franbird` / `/bird` in a Slack **thread** loads context with `conversations.replies` and replies with `thread_ts`
- Existing tell / templates / stamps / approval cards unchanged (writes still approval-card only)
- `/bird help` + `/bird whoami` (basic)

## Stubbed

- Staff routing intents → tool allowlists (`hrm.roster`, `docs.index`, `skums.read`, `pos.read`) return stub messages only
- `LLM_ROUTING_ENABLED` env + `XAI_API_KEY` → xAI chat completions classify freeform → intents (tool stubs + kiv/ask/escalate); off = keywords
- No live FranHRM / docs / skums / pos reads
- No BotFather / Telegram / wacli / WH Class C
- No auto-commit of writes

## Deploy note

LLM path is env-gated. Writes stay approval-card only. Leave WH / fran-pos held PRs alone.
