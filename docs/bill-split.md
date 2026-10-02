# Bill-split / Splitwise-lite

Single source of truth on the fran-ops bus DB for Slack **and** Telegram in parallel.

## Tables (`migrations/004_bill_split.sql`)

| Table | Role |
| --- | --- |
| `bill_expenses` | Expense draft/confirmed/void; receipt URI pointer; parse confidence |
| `bill_shares` | Per-staff share cents (must sum to amount) |
| `bill_settlements` | Settle events (from paid to) |

**Balances** are derived in `src/bill_math.ts` from confirmed expenses + settlements (not a stored table).

## Surfaces

- **Slack:** `/bird split …`, freeform via `@Franbird`, receipt image → URI + extract → **confirm card** (`bill.confirm` / `bill.reject`). `tally`, `paid`/`settle`, `remind`. Allowlist: `CHANNEL_ALLOWLIST` + `SLACK_EXTRA_CHANNELS`.
- **Telegram:** webhook `POST /telegram/webhook` when `TELEGRAM_BOT_TOKEN` set. Commands `/split`, `/tally`, `/settle`, `/confirm_expense`, `/reject_expense`. Allowlist: `TELEGRAM_EXTRA_CHATS`.

Both resolve actors via `staff_identities.slack_user_id` / `telegram_user_id`.

## Rules

- Ambiguous parses and all writes stay `pending_confirm` until confirm — **no auto-commit**.
- Receipt path stores pointer only (`slack://fileId` or `telegram://file_id`); optional xAI extract when `LLM_ROUTING_ENABLED` + `XAI_API_KEY`.
- Class D: applying `004_bill_split.sql` on the droplet waits for JT yes.

## Env var names

| Var | Required for |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Live TG webhook |
| `TELEGRAM_WEBHOOK_SECRET` | Optional secret-token header check |
| `TELEGRAM_EXTRA_CHATS` | TG chat allowlist extras |
| `SLACK_EXTRA_CHANNELS` | Slack channel extras (existing) |
| `LLM_ROUTING_ENABLED` / `XAI_API_KEY` / `XAI_BASE_URL` / `XAI_MODEL` | Receipt extract (optional) |

## BotFather steps (JT)

1. `@BotFather` → `/newbot` (or reuse) → copy token → `TELEGRAM_BOT_TOKEN`.
2. Set webhook: `https://ops.heyfran.co/telegram/webhook` (and optional secret via `setWebhook` `secret_token` → `TELEGRAM_WEBHOOK_SECRET`).
3. Add chat ids to `TELEGRAM_EXTRA_CHATS`.
4. Link staff: set `staff_identities.telegram_user_id` for participants.
5. Restart fran-ops systemd unit after env edit.

## Smoke (Slack)

On an allowlisted channel with linked staff:

```
/bird split 45.50 lunch with @Bob
→ confirm card → Confirm
/bird tally
/bird paid @Bob 22.75
/bird remind
```

## Out of scope

WH Class C, fran-pos #27–30, pickletour. Droplet mig apply is Class D — not done in this PR.
