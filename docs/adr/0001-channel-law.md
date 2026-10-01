# Channel law

The CTO owns the permanent channel list in code. `CHANNEL_ALLOWLIST` in `src/allowlist.ts` is that list. At runtime, `loadChannelAllowlist()` merges code grants with optional `SLACK_EXTRA_CHANNELS` from env (real `C…`/`G…` ids only; invalid tokens skipped; code wins on duplicates). The bus drops a Slack event whose channel is absent from the effective list, even when `channel_allowlist` already has the row.

The table exists so a task can reference a channel. `openTask` upserts the matching code/env grant, then inserts the task. A database-only row is not a grant.

The Slack app is Bolt on the HTTP Events API. `socketMode` is false. The path is `/slack/events`. There is no headless client and no Socket Mode.

`/bird` takes one key from `TASK_TEMPLATE_KEYS` (except free-text), or a Franbird tell, or `help`. `parseFranText` rejects a second word on templates, so a person cannot type a new task. A normal channel message is stored as `channel.message` and does not create a task.

`REACTION_TO_STAMP` maps five Slack reaction names to `claim`, `done`, `blocked`, `hand_off`, and `escalate`. An unknown reaction writes no stamp.

Ops guide for JT: `docs/slack-ops.md`.
