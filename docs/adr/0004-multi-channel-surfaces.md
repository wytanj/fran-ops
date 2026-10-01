# ADR 0004 — Multi-channel surfaces (Slack deepen, WA ingest, Telegram)

**Date:** 2026-10-01  
**Status:** Accepted (plan); runtime not in this change  
**Context pack:** `docs/plans/2026-10-01-channels-slack-wa-tg.md`

## Context

fran-ops already models `surface` as `slack` | `telegram`, ships Slack Bolt on HTTP Events at `https://ops.heyfran.co/slack/events`, and leaves Telegram outbox rows pending. WhatsApp enters through **wacli** into storage tiers, not as a third task bus client in the first cut. Slack app permissions are complete; deepen Slack before WA/TG runtime.

## Decision

1. **Order:** Deepen live Slack (templates, allowlist hooks, staff Slack map UX, tell flows, card polish) before wiring Telegram Bot API or always-on wacli follow.
2. **Slack remain primary** human control plane until Telegram identity coverage is real; one `staff_id`, two client columns.
3. **Channel law unchanged:** grants live in `src/allowlist.ts` per surface; DB rows are not grants.
4. **WhatsApp:** linked-device session via wacli; prefer droplet for live follow after JT pairs; history backfill before live; eSIM later. Ingest targets warm packs + `media_index` first; optional Slack media inbox copy later.
5. **Telegram:** webhook at `https://ops.heyfran.co/telegram/webhook` on the same Bun process behind Caddy; stub → identity link → commands → `publishPending` Telegram; coexist with Slack without duplicate fan-out unless a card template says so.
6. **Secrets:** BotFather token and Slack tokens only in `/etc/fran-ops.env`; wacli session only in store dir (0600); never commit.

## Consequences

- Next runtime PRs are small Slack UX slices (help, whoami, tell/card polish), then allowlist/staff map data from JT.
- Telegram and wacli get stub issue lists and URL/host decisions now; no half-broken handlers in the plan PR.
- Agents must not apply storage migration or set webhooks until JT supplies tokens/ids in his own words.

## Alternatives rejected

- Waiting on more Slack OAuth scopes — already done.
- Making WhatsApp a full `surface` for `/bird` tasks in P0 — storage tiers first.
- Socket Mode — keep HTTP Events.
- Pairing wacli only on DESKTOP long-term — fine for QR; not for always-on ops.
