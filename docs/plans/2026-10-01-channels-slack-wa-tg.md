# Franbird channels plan — Slack deepen, then WA + Telegram

**Status:** plan only (no runtime wiring in this PR)  
**Branch:** `loop/channels-wa-tg-plan`  
**Host:** DigitalOcean SG `ops.heyfran.co` → `/opt/fran-ops`, env `/etc/fran-ops.env`  
**Repo:** `wytanj/fran-ops` on `master` after PRs #1–#4  
**DESKTOP:** machineId `2ddf5cc6-587a-4913-8459-5fa9aac26bd6`; CodeProjects under `C:\Users\Jeremy Tan\CodeProjects\` (local clone `fran-ops` present)

**Priority lock (JT/CoS 2026-10-01):** Slack app permissions are **done**. Do **not** wait on more Slack install. Deepen live Slack first; WA/TG follow as planned slices.

Related ADRs: `0001-channel-law`, `0002-staff-identity`, `0003-storage-tiering`. Companion decision note: `docs/adr/0004-multi-channel-surfaces.md`.

---

## 0. Current baseline (live)

| Surface | State |
| --- | --- |
| Slack Events HTTP | Live at `https://ops.heyfran.co/slack/events`; Socket Mode **off** |
| Slash | `/bird` (and legacy `/fran` template path in handlers) |
| Allowlist | Code grant only: Slack `C0C5GDWHBNX` (`all-fran`) in `src/allowlist.ts` |
| Templates | `shift_open`, `shift_close`, `incident`, `hand_off`, `tell` |
| Tell | App mention + `/bird tell <@U…> <body> [briefing=…]`; outbox cards Approve / Send back |
| Staff map | `staff_identities.slack_user_id` required for commands/stamps; many staff may still be unlinked |
| Telegram outbox | `destination = telegram` rows stay `pending` (`publishPending` Slack-only) |
| wacli | Types + ingest stubs under `src/wacli/`; no live session wired to bus |

---

## 1. Franbird Slack deepen (build next on live Slack)

Slack is the active control surface. Next work should make day-to-day Franbird useful on `#all-fran` (and later allowlisted channels) **without** touching WA/TG runtime yet.

### 1.1 Channel allowlist expansion hooks

**Today:** CTO-owned `CHANNEL_ALLOWLIST` in code; DB `channel_allowlist` is not a grant (`0001`).

**Plan:**

1. Keep code as source of truth.
2. Add a small **ops checklist + PR template** for adding a Slack channel: name, `C…` id, purpose, who may `/bird` there.
3. Optional later helper (still plan-only here): `scripts/print-allowlist.ts` or docs table mirroring live grants — no admin UI yet.
4. When JT supplies extra channel IDs, land them as one-line grants in `src/allowlist.ts` + deploy pull on droplet.

**Concrete next implement slices (Slack):**

| Slice | Scope | Risk |
| --- | --- | --- |
| **S1** | Document + PR for 1–N new Slack channel grants once JT pastes `C…` ids | Low |
| **S2** | Sync helper: on boot, upsert code grants into `channel_allowlist` (already partly via `openTask`); make ingest path consistent / logged | Low |

### 1.2 Staff Slack map linking UX

**Today:** Unlinked Slack users get `"Your Slack user is not linked to a staff record."` — no self-serve link flow.

**Plan:**

1. **Ops path (first):** JT/CoS SQL or tiny admin script: `staff_id` ↔ `slack_user_id` (+ optional `display_name`). Prefer secure one-shot over chat-pasted tokens.
2. **In-Slack UX (next):** `/bird whoami` → shows linked staff label or “unlinked”; `/bird link <staff_code>` **or** ephemeral “request link” that opens a CoS approval card (no auto-trust of free text staff ids without allowlist).
3. Surface unlinked actors on stamp/tell attempts with a short “ask CoS to link” reply (already close; polish copy + log).

| Slice | Scope | Risk |
| --- | --- | --- |
| **S3** | `/bird whoami` + clearer unlink replies | Low |
| **S4** | CoS-approved link flow (card or scripted upsert); never scrape Slack OAuth beyond bot token already set | Med |

### 1.3 Templates

**Today:** Four shift/incident templates + `tell`. Free text rejected.

**Plan:**

1. Keep template-only law.
2. Add **template cards** that show fields as Block Kit (not free-text create): e.g. `incident` severity enum, `hand_off` to-staff picker when linked.
3. Candidate new keys (only after JT yes): `avail_cover`, `pos_pin_confirm` — align with company-OS notes; do not invent without CoS.
4. `/bird` help text listing templates + tell grammar in one ephemeral reply.

| Slice | Scope | Risk |
| --- | --- | --- |
| **S5** | `/bird help` ephemeral + tighter template error strings | Low |
| **S6** | Richer Block Kit for existing templates (no new keys) | Med |

### 1.4 Tell flows

**Today:** Parse tell from mention/`/bird`; channel ack + assignee DM + `draft_for_approve`; Approve/Send back; `resolvedTellCard`.

**Plan:**

1. Polish: thread reply on success (optional flag), clearer briefing badges, assignee DM includes deep link / channel ref.
2. Stamp reactions on tell cards after `message_ref` (already mapped) — verify live on `#all-fran` and fix gaps only.
3. Deny tell to self / deny tell when assignee lacks Slack id with explicit reason.
4. Idempotency already keyed; add ops log line for tell open/approve for CoS audit.

| Slice | Scope | Risk |
| --- | --- | --- |
| **S7** | Tell UX polish + self/assignee guards + success thread ack | Low |
| **S8** | Live smoke checklist on droplet (no code if pass): open tell → DM → approve → stamp | Ops |

### 1.5 Card polish

**Today:** Minimal header/section/actions in `src/cards.ts`.

**Plan:**

1. Consistent staff labels (`display_name` → mention → short id) everywhere — already intended in `0002`; audit call sites.
2. After decision, update original message to `resolvedTellCard` (or append context block) so channel doesn’t keep live Approve buttons.
3. Failed outbox: surface CoS alert (Slack DM to JT or `#all-fran` ops note) instead of silent `failed`.

| Slice | Scope | Risk |
| --- | --- | --- |
| **S9** | Resolve/update card after approve/send_back; disable stale buttons | Med |
| **S10** | Outbox `failed` → JT/CoS notify | Med |

### Recommended Slack order

**S5 → S3 → S7 → S9 → S1 (when IDs arrive) → S4 → S6/S10.**  
Ship one PR per slice; deploy `/opt/fran-ops` pull + `systemctl restart fran-ops` after JT merge.

---

## 2. wacli ingest (history stretch; eSIM later)

### 2.1 Goal

Use **JT’s existing WhatsApp chat presence** (linked-device session) to backfill / stretch history into fran-ops storage tiers (warm `contextpacks/wa/…` + hot `media_index`), then optionally live-follow. **eSIM / dedicated number is explicitly later** — do not block on hardware.

### 2.2 Where wacli runs

| Option | Pros | Cons | Recommendation |
| --- | --- | --- | --- |
| **A. Same DO SG droplet** (`/opt/fran-ops` or `/var/lib/wacli`) | Always-on; same network as bus; SG latency | Session keys on VPS; QR pair needs SSH/agent path; phone must allow linked device | **Preferred for live `--follow` after JT pairs once** |
| **B. DESKTOP** (`C:\Users\Jeremy Tan\…`) | Pairing UX easy; JT already on machine | Sleep/lock kills sync; not ops-grade | **OK for first QR pair + history export only** |
| **C. Split** | Pair/export on DESKTOP → rsync store or export JSON to droplet | Session move is fragile; prefer export artifacts not raw `session.db` copy across OS without care | Use **export/ingest files**, not blind DB copy |

**Decision (plan):** Phase 0 pair on **DESKTOP or interactive SSH on droplet** (JT present). Phase 1 **history backfill** via `wacli` history/sync → JSON/md → existing `src/wacli/ingest.ts` stubs. Phase 2 **live** `wacli sync --follow` as systemd unit on **droplet** with store under e.g. `/var/lib/wacli` (`WACLI_STORE_DIR`), owner-only perms. Do **not** commit session files.

Default store locations (wacli): Windows/macOS `~/.wacli`; Linux `~/.local/state/wacli` (or legacy `~/.wacli`); override `--store` / `WACLI_STORE_DIR`. Contains `session.db`, `wacli.db`, `media/`, `LOCK`.

### 2.3 Auth model

1. Linked WhatsApp Web device via QR (`wacli` auth / accounts add).
2. JT scans with the phone that already holds Fran business chats.
3. One named account (e.g. `--account fran`) isolated store.
4. Secrets stay on disk 0600; never print; never put in `/etc/fran-ops.env` as WA session blobs.
5. Re-pair if primary phone revokes device; document runbook only.

### 2.4 History backfill vs live

| Mode | Behavior | Fran-ops hook |
| --- | --- | --- |
| **Backfill** | `history` / sync bounded by `--max-messages` / chat allowlist; export markdown or JSON | Call `ingestWaText` / `ingestWaMedia` → warm pack + placeholder then real Supabase path |
| **Live** | `sync --follow` → side process posts or drops files for a thin importer | Importer writes `channel.message`-like events **only** if we add `surface: whatsapp` later; until then **storage tiers only**, not Slack task bus |
| **Slack copy** | Optional later: recent media → allowlisted Slack inbox | Blocked on JT channel choice + rate limits; not P0 |

**Allowlist chats:** JT must name JIDs / groups to ingest (finance-hr-it style). No full-phone mirror into git.

### 2.5 Stub issue list (wacli) — implement later

1. Confirm host: droplet vs DESKTOP for pair.
2. Install wacli on chosen host; pair; `wacli doctor --connect`.
3. Document store path; systemd unit sketch (droplet).
4. Bounded backfill CLI wrapping `src/wacli/ingest.ts`.
5. Apply `migrations/002_storage_index.sql` only after JT yes (class D).
6. Supabase bucket name/policy (JT).
7. eSIM / second number — **out of scope** until history stretch proven.

---

## 3. Telegram surface (BotFather → webhook stub → real)

### 3.1 Goal

Fran-bird on Telegram shares **same event types** as Slack (`0002`). Outbox already allows `destination = telegram`. Ship **webhook URL shape + stub handler** first; real Bot API after token.

### 3.2 URL shape

Canonical (alongside Slack):

```text
https://ops.heyfran.co/telegram/webhook
```

Optional secret path suffix later: `/telegram/webhook/<token-suffix>` or header `X-Telegram-Bot-Api-Secret-Token` — prefer secret token header over putting bot token in URL.

Caddy already proxies `ops.heyfran.co` → `localhost:3000`; add route in Bun app (not a second process).

### 3.3 Phases

| Phase | What | Runtime? |
| --- | --- | --- |
| **T0 Stub** | `POST /telegram/webhook` returns 200; verifies optional secret; logs update type; **no** bus writes | Risk-free stub only when JT asks; **this PR does not add it** unless separately approved |
| **T1 Identity** | `/start` + link code ↔ `staff_identities.telegram_user_id` | Needs BotFather token |
| **T2 Commands** | Mirror `/bird` templates + tell grammar (Telegram UX: buttons) | Shared bus commands |
| **T3 Publish** | `publishPending` sends Telegram rows (`sendMessage`) | Completes dual-client |
| **T4 Groups** | Allowlisted TG group/channel ids in `CHANNEL_ALLOWLIST` with `surface: "telegram"` | Needs JT ids |

### 3.4 Slack coexistence

- One bus, two surfaces; one `staff_id`.
- Slack remains primary ops for HQ until TG link coverage is good.
- Do not dual-notify the same outbox event to both unless card template says so.
- Channel law stays code allowlist per surface.

### 3.5 Stub issue list (Telegram)

1. BotFather create **fran-bird**; send token via secure channel → `/etc/fran-ops.env` as `TELEGRAM_BOT_TOKEN` (never commit).
2. Set webhook to `https://ops.heyfran.co/telegram/webhook` (+ secret).
3. JT: TG user id(s), group/channel ids for allowlist.
4. Implement T0→T3 in ordered PRs; tests with recorded Update JSON fixtures.

---

## 4. Architecture sketch

```text
                    ┌─────────────────────────────┐
  Slack Events ────►│  fran-ops (Bun) :3000         │
  /slack/events     │  handlers → bus → outbox      │
                    │  publishPending → Slack API   │
  TG webhook ──────►│  (later) TG handlers → same   │──► Postgres bus
  /telegram/webhook │  publishPending → Bot API     │
                    └──────────────┬────────────────┘
                                   │
  wacli (droplet or DESKTOP)       ▼
  session store ──export/ingest──► storage tiers
                                   (warm packs + media_index
                                    + later Supabase objects)
```

---

## 5. Need from JT (checklist)

Copy/paste answers into the PR thread or CoS chat.

### Slack deepen (now)

- [ ] **Extra Slack channel IDs** to allowlist (name + `C…` id + purpose). Current: `all-fran` / `C0C5GDWHBNX` only.
- [ ] **Unlinked staff Slack maps:** list of `{ staff_id or FranHRM name, slack_user_id U…, display_name? }` to upsert — or “I’ll paste CSV”.
- [ ] Confirm whether **success tell** should thread-ack in-channel (yes/no).
- [ ] Any **new template keys** wanted in next 2 weeks (or freeze on current five).

### wacli (after Slack slices S5/S3/S7 or parallel if JT pairs)

- [ ] **Pair host choice:** DESKTOP QR first vs SSH on `root@167.99.68.48`.
- [ ] **Store path** if not default: Windows `C:\Users\Jeremy Tan\.wacli` or droplet `/var/lib/wacli`.
- [ ] **Chat allowlist** for history stretch (names/JIDs); max history bound.
- [ ] Confirm **eSIM later** (yes — do not block).
- [ ] Supabase Storage bucket name/policy when leaving placeholders (can wait).

### Telegram (later)

- [ ] **BotFather token** for fran-bird via secure channel (not chat).
- [ ] **TG user ids** for JT + staff to link.
- [ ] **TG group/channel ids** to allowlist (if any in P1).
- [ ] Preferred webhook secret method (header vs path suffix).

### Explicit non-needs

- [x] Further Slack app permission scopes — **done**; do not block.

---

## 6. Recommended next implement slice

**Immediate (post-merge of this plan):** **S5 `/bird help` + S3 `/bird whoami`** on a focused runtime PR (not this branch). Deploy to droplet after JT merge.

**Then:** **S7 tell polish** → **S9 card resolve-in-place**.

**Parallel ops (JT):** paste extra channel IDs + staff Slack map CSV → **S1/S4**.

**After Slack is sticky:** wacli pair on chosen host → bounded backfill using existing `src/wacli` stubs → Telegram T0 stub PR when token is ready.

---

## 7. Out of scope for this PR

- No Telegram webhook handler, no wacli systemd, no half-broken imports.
- No migration apply, no secret printing, no merge to `master` without JT.
- No eSIM procurement.
