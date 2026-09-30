# Kick contract for fran-ops

This file says what a kicked session owes the outer loop (Grok Bot) when it finishes. It is a draft. Amend it by PR.

## Scope classes

The classes come from `agent-home/operating-model.md`. That file wins if the two disagree.

| Class | Meaning | Who acts |
| --- | --- | --- |
| A | Local work and a dev database: code, tests, docs, drafts, the session's own worktree and branch | The kicked session |
| B | Production, read-only: health checks, status reads, dry runs | Outer loop |
| C | Production, reversible: merge a green PR into the default branch | Outer loop, logged on the PR |
| D | Production, irreversible: applying `migrations/001_bus.sql` to a shared database, data fixes, customer messages | Outer loop runs the dry run, then waits for JT's yes in his own words |

This repo has no production deploy command. Do not invent a `vercel --prod` step for it.

A kicked session does class A only. It stages B, C, and D commands in its report and never runs them. It never merges, deploys, applies a migration to a shared database, or force-pushes.

## Worktree rules

A session works only in the worktree it was kicked into. It does not create another worktree. It does not touch the owner's main checkout at `C:\Users\Jeremy Tan\CodeProjects\fran-ops`.

The session pushes only the branch it was kicked on. The PR targets the default branch.

## Source-of-truth locks

These locks hold for every kick.

- The bus lives in this repo. Do not put bus logic in fran-hrm, fran-skums, or fran-pos.
- `CHANNEL_ALLOWLIST` in `src/allowlist.ts` is the channel list. The CTO changes it in code.
- `/fran` accepts only template keys. There is no free-text new task.
- `staff_identities` maps one staff id to one Slack user id and one Telegram user id. The same person is not two rows.
- Slack and Telegram share `event_type`. `surface` and `outbox.destination` say which client.

## What the session returns

Report these, verdict first, in plain bullets.

- The draft PR URL, as `https://github.com/wytanj/fran-ops/pull/<number>`. When `gh` is not authenticated, push the branch and return the GitHub compare URL instead, so JT can open the draft.
- Files touched, as a list of paths with one clause each on what changed.
- Verify notes. Name where each check ran and what it proved.
- What was staged rather than done, with its class and the exact command.
- Anything that blocked, and what unblocks it.

## Briefs

A kick may carry a brief at `docs/agents/briefs/<slug>.md`. When the PR finishes that item, the same PR deletes the brief. A PR that only advances the item updates the brief and leaves it in place.

## Done webhook

When `%USERPROFILE%\.config\agent-loop\done-webhook.env` is present, the session POSTs to `DONE_WEBHOOK_URL` on finish with `Authorization: Bearer $DONE_WEBHOOK_KEY` and `X-Automation-Key: $DONE_WEBHOOK_KEY`.

```json
{
  "event": "session_done",
  "repo": "fran-ops",
  "slug": "slack-fast-scaffold",
  "session": "grok-slack-fast-scaffold",
  "status": "ok",
  "summary": "one or two sentences",
  "pr_url": "https://github.com/wytanj/fran-ops/pull/<number>",
  "class_c_ready": false
}
```

`session` is the kick session name. A Claude kick uses `claude-<slug>`. A Grok kick uses `grok-<slug>`.

Set `class_c_ready` to true only when the PR is ready for the class C merge. The key never appears in chat, logs, or a commit.

When the env file is absent, the session says so in its reply and posts nothing.
