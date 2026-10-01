# Next slices

These slices do not block Slack ingest or the Slack outbox publisher.

## Storage tiers (this scaffold)

Hot / warm / cold rules: `docs/adr/0003-storage-tiering.md`, ops guide `docs/storage-tiers.md`.

- HOT index: `migrations/002_storage_index.sql` + `src/storage.ts` (no blobs in Postgres).
- WARM packs: `contextpacks/` (see `contextpacks/README.md` for prune/rollup).
- COLD: Drive/bucket pointers on `media_index.cold_uri` — JT still owes a Drive folder/share before real uploads.
- Slack remains the recent human media inbox, not the archive.

## WhatsApp / wacli

- Stubs: `src/wacli/` (`types.ts`, `ingest.ts`). Builds warm `.md` under `contextpacks/wa/…` and a `media_index` insert with placeholder `cold_uri`.
- Does **not** upload to Drive or Slack in this PR. No Slack secrets required for the storage-tiering scaffold.
- Later: copy recent WA media onto an allowlisted Slack channel once PR #1 Slack install is live; cold archive still goes to Drive.

## Telegram bird client

fran-bird on Telegram reads and writes the same event types as Slack. It should publish rows where `outbox.destination` is `telegram`. `publishPending` leaves those rows `pending` until that client exists.
