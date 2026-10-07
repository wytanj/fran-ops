# Harness HTTP + MCP scaffold (personal Grok bots)

fran-ops is the company AI infra SoT. Personal Grok Bots are **harnesses only** — they call this thin surface; they are not a peer SoT and must not use a Slack bot↔bot identity. Slack remains the **human doorbell**.

## Auth

Set `FRAN_OPS_HARNESS_TOKEN` in `/etc/fran-ops.env` (never commit the value).

| Mode | How |
| --- | --- |
| Bearer | `Authorization: Bearer <FRAN_OPS_HARNESS_TOKEN>` |
| HMAC | `X-Fran-Ops-Signature: sha256=<hex(hmac_sha256(raw_body, token))>` |

If the env var is unset, routes are **not mounted**.

## HTTP endpoints (same process as Slack Bolt)

| Method | Path | Maps to |
| --- | --- | --- |
| POST | `/harness/issues/raise` | hardware issue raise (outbox approve card = Slack doorbell) |
| POST | `/harness/asset_events` | append-only `asset_events` (`crack\|claim_filed\|oow\|repair\|swap\|retire`) |
| GET | `/harness/tasks/mine?staffId=<uuid>` | task inbox (`/bird mine` equivalent) |

Host today: `https://ops.heyfran.co` (Caddy → Bun). Scaffold only; Class C merge before deploy.

### curl examples

```bash
TOKEN=…  # from env, not committed
# Issue raise
curl -sS -X POST "https://ops.heyfran.co/harness/issues/raise" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"raiserStaffId":"<uuid>","idempotencyKey":"demo-1","photos":[{"slackFileId":"F0DEMO"}],"caption":"device: demo"}'

# Asset event
curl -sS -X POST "https://ops.heyfran.co/harness/asset_events" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"serial":"R5GL855Q7PD","eventType":"oow","idempotencyKey":"oow-1"}'

# Task inbox
curl -sS "https://ops.heyfran.co/harness/tasks/mine?staffId=<uuid>" \
  -H "Authorization: Bearer $TOKEN"
```

## MCP tool stubs

`src/harness_mcp.ts` declares three tools that dispatch to the same handlers:

- `fran_ops_issue_raise`
- `fran_ops_asset_event_append`
- `fran_ops_task_inbox`

Later: install an MCP server that imports `HARNESS_MCP_TOOLS` + `dispatchHarnessMcpTool` and authenticates with the same token. Until then, curl/Bearer is enough for harnesss.

## Slack doorbell boundary

- Issue raise (doorbell true, default) uses `raiseHardwareIssue` → outbox `issue_approve` card in `#it-helpdesk` — humans see it in Slack.
- Harnesses do **not** post as a second Slack bot user.
- `/bird` write lane stays on channel allowlist; harness auth is token-gated, separate from Slack allowlist.

## Migrations

Uses existing `005_issues` / `006_assets` / bus tasks. **No new migs** in this scaffold.

## Deploy notes

1. Class C clear + merge.
2. Set `FRAN_OPS_HARNESS_TOKEN` on droplet; restart `fran-ops`.
3. Confirm routes mount (token present) and 401 without Bearer.
4. Do not treat Grok as SoT; all writes go through these handlers into Postgres.
