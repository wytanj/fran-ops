# Channel law

The CTO owns the channel list in code. `CHANNEL_ALLOWLIST` in `src/allowlist.ts` is that list. The bus drops a Slack event whose channel is absent from the list, even when `channel_allowlist` already has the row.

The table exists so a task can reference a channel. `openTask` upserts the matching code grant, then inserts the task. A database-only row is not a grant.

The Slack app is Bolt on the HTTP Events API. `socketMode` is false. The path is `/slack/events`. There is no headless client and no Socket Mode.

`/fran` takes one key from `TASK_TEMPLATE_KEYS`. `parseFranText` rejects a second word, so a person cannot type a new task. A normal channel message is stored as `channel.message` and does not create a task.

`REACTION_TO_STAMP` maps five Slack reaction names to `claim`, `done`, `blocked`, `hand_off`, and `escalate`. An unknown reaction writes no stamp.
