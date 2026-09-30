# fran-ops

fran-ops is the ops bus for fran-bird. One employee has one staff id. Slack and Telegram use the same event types. Bus code stays in this repo.

## Bus tables

`migrations/001_bus.sql` creates these tables.

| Table | What a row is |
| --- | --- |
| `staff_identities` | One FranHRM staff id, with that person's Slack user id and Telegram user id |
| `channel_allowlist` | A copy of one grant from `src/allowlist.ts` |
| `events` | One bus event. `event_type` is shared by both clients. `surface` is `slack` or `telegram` |
| `tasks` | One opened template |
| `stamps` | One of `claim`, `done`, `blocked`, `hand_off`, `escalate` on a task |
| `outbox` | One outbound card for one event, one destination, and one card template |
| `summaries` | A later rollup for one channel and one period. No writer in this slice |

## Staff identities

`staff_id` is `public.staff.id` from FranHRM, copied by value. This database has no foreign key to FranHRM. `employment` is `full_time` or `part_time`. Those employees get fran-bird on Slack and on Telegram. `channel_prefs` defaults to `{}`.

Partial unique indexes stop a second row from taking the same Slack user id or the same Telegram user id.

## Slack Bolt

`src/slack.ts` builds a Bolt app on the HTTP Events API. `socketMode` is false. Slack should send events, slash commands, and block actions to `/slack/events`.

`message` on an allowlisted channel writes `channel.message`. The text does not open a task. `reaction_added` uses this map in `REACTION_TO_STAMP`.

| Reaction | Stamp |
| --- | --- |
| `eyes` | `claim` |
| `white_check_mark` | `done` |
| `no_entry_sign` | `blocked` |
| `handshake` | `hand_off` |
| `rotating_light` | `escalate` |

Any other reaction is ignored. The stamp applies only after the card has a `message_ref`.

`/fran` accepts one of `shift_open`, `shift_close`, `incident`, or `hand_off`. A second word is rejected. Free-text New Task is rejected.

`app_mention` on `@franbird tell <@U…> <message> briefing=optional|required` opens a structured `tell` task (not free-text New Task). Looks up actor and assignee via `staff_identities`. Sets `tasks.briefing_required` when briefing is `required` (stub flag for a later daily briefing job). Enqueues channel ack + assignee DM ack (`card_template=ack`) plus a draft-for-approve card; `publishPending` posts them with `chat.postMessage`.

`card.approve` writes `card.approved`. `card.send_back` writes `card.sent_back`.

`CHANNEL_ALLOWLIST` in `src/allowlist.ts` ships empty. Add a channel in that file. A channel that exists only in `channel_allowlist` does not admit a new event.

## Env vars JT must set

| Var | Required | Notes |
| --- | --- | --- |
| `SLACK_BOT_TOKEN` | yes | Bot token (`xoxb-…`) for Events API + `chat.postMessage` |
| `SLACK_SIGNING_SECRET` | yes | Request signature verification |
| `DATABASE_URL` | yes | Postgres connection string for the bus |
| `PORT` | no | HTTP listen port, default `3000` |
| `SLACK_APP_TOKEN` | no | App-level token (`xapp-…`) only if you switch on Socket Mode later; HTTP Events API is the default (`socketMode: false`) |

`bun start` reads those. The process calls `publishPending` every 5 seconds (bus → Slack outbound).

## Outbox and cards

`draftForApproveCard` in `src/cards.ts` builds the Slack card. The card has Approve and Send back. `openTask` stores it on an outbox row with `card_template` `draft_for_approve`. `destination` is the client that opened the task. `publishPending` posts Slack rows with `chat.postMessage` and leaves Telegram rows `pending`.

A thrown post marks the row `failed`. `publishPending` does not pick up a `failed` row. A row left in `publishing` for more than 300 seconds is claimed again.

## Checks

`bun test` applies `migrations/001_bus.sql` on embedded Postgres, runs the bus commands, and posts signed requests at a local Bolt server. `bun run typecheck` runs `tsc --noEmit`.

## Constraints

- Keep this bus out of fran-hrm, fran-skums, and fran-pos.
- Do not open a task from free text.
- Do not apply `migrations/001_bus.sql` to a shared database from a kicked session. That apply is class D. The outer loop runs it only after JT says yes in his own words.

## Next

`contextpacks/NEXT.md` names the slices that come after this one.
