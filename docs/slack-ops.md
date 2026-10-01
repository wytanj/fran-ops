# Slack Franbird ops (channel IDs + staff maps)

How JT adds allowlisted channels and links staff Slack users. No new Slack app scopes required for these steps.

## Channel allowlist

Code is the source of truth for permanent channels (`CHANNEL_ALLOWLIST` in `src/allowlist.ts`). Live today includes `all-fran` (`C0C5GDWHBNX`).

### Option A — permanent (code)

1. Edit `src/allowlist.ts` and add `{ surface: "slack", channelId: parseSlackChannelId("C…"), name: "human-name" }`.
2. Open a PR; after merge + deploy, restart `fran-ops`.

### Option B — extra channels via env (no code change)

Set on the VPS in `/etc/fran-ops.env` (never commit secrets or paste this file into chat):

```bash
# Comma or semicolon. Name after colon is optional.
SLACK_EXTRA_CHANNELS=C012ABCDE:ops-floor,C012FGHIJ:shift-lead
```

Then:

```bash
sudo systemctl restart fran-ops
```

Rules:

- Only real Slack channel IDs (`C…` or `G…`). Invalid tokens are skipped — nothing invents fake IDs.
- Code grants win on duplicate IDs; env only adds extras.
- Invite the Franbird bot into each new channel before expecting `/bird` or ingest.

How to copy a channel ID in Slack: channel details → copy channel ID.

## Staff Slack maps

One FranHRM `staff_id` (uuid) maps to one `slack_user_id` on `staff_identities`. Cards prefer `display_name`, then `<@U…>`, then a short id.

### Preferred — script (uses `DATABASE_URL` from env)

From a machine that can reach Postgres (VPS checkout or tunnel):

```bash
# Link / update Slack user; does not wipe telegram_user_id
bun scripts/link-staff.ts \
  --staff-id 11111111-1111-4111-8111-111111111111 \
  --slack-user U0ABCDEF \
  --employment full_time \
  --display-name "Alice"

# Display name only
bun scripts/link-staff.ts \
  --staff-id 11111111-1111-4111-8111-111111111111 \
  --display-name "Alice"

# List maps (ids/names only)
bun scripts/link-staff.ts --list
```

How to copy a Slack user ID: profile → ⋮ → Copy member ID.

### Alternate — SQL (ops)

```sql
insert into staff_identities (staff_id, employment, slack_user_id, display_name)
values ('11111111-1111-4111-8111-111111111111', 'full_time', 'U0ABCDEF', 'Alice')
on conflict (staff_id) do update set
  employment = excluded.employment,
  slack_user_id = excluded.slack_user_id,
  display_name = coalesce(excluded.display_name, staff_identities.display_name),
  updated_at = now();
```

Apply migrations `001` / `003` only with JT yes (class D). Display name column is `003_staff_display_name.sql`.

## `/bird` cheat sheet

| Input | Effect |
| --- | --- |
| `/bird` or `/bird help` | Usage |
| `/bird shift_open` (etc.) | Open template card |
| `/bird tell <@U…> cover open briefing=required` | Franbird tell |
| `@Franbird tell <@U…> …` in allowlisted channel | Same tell via mention |

Approve / Send back keep `card.approve` / `card.send_back` and `replace_original` (section body preserved).

## What still needs JT

- Paste real channel IDs into `SLACK_EXTRA_CHANNELS` (or a code PR) when adding rooms beyond `all-fran`.
- Link each staff uuid ↔ Slack `U…` (and optional display names) before `/bird` / tell works for that person.
