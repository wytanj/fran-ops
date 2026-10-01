# Next slices

These slices do not block Slack ingest or the Slack outbox publisher.

## Storage tiers (this scaffold)

Hot / warm / version-store / Drive-context rules: `docs/adr/0003-storage-tiering.md`, ops guide `docs/storage-tiers.md`.

- HOT index: `migrations/002_storage_index.sql` + `src/storage.ts` (no blobs in Postgres; no long-lived signed URLs).
- WARM packs: `contextpacks/` (see `contextpacks/README.md` for prune/rollup).
- VERSION STORE: **Supabase Storage** via `media_index.supabase_object_path` -- versioned file objects are retrieved/replaced as artifacts evolve; JT still owes bucket name/policy before real uploads; mint signed URLs at read time.
- Drive: **contextual/organized files** and `drive_folders` purpose/placement context, linked from `media_index.drive_folder_id`; not the version store.
- Slack remains the recent human media inbox, not the archive (#1 still separate).

## WhatsApp / wacli

- Stubs: `src/wacli/` (`types.ts`, `ingest.ts`). Builds warm `.md` under `contextpacks/wa/…` and a `media_index` insert with placeholder `supabase_object_path`.
- Does **not** upload to Supabase Storage or Google Drive (as the version store or bulk dump) or Slack in this PR. Env hints: `SUPABASE_URL` + service role later; no Slack secrets required for the storage-tiering scaffold.
- Optional: `linkDriveFolderPurpose` to register a human Drive folder purpose row.
- Later: copy recent WA media onto an allowlisted Slack channel once PR #1 Slack install is live; blob archive still goes to Supabase Storage.

## Channel plan (2026-10-01)

Priority: deepen live Slack first (permissions done), then wacli history + Telegram webhook.
Full plan: `docs/plans/2026-10-01-channels-slack-wa-tg.md` (ADR `docs/adr/0004-multi-channel-surfaces.md`).

## Telegram bird client

fran-bird on Telegram reads and writes the same event types as Slack. It should publish rows where `outbox.destination` is `telegram`. `publishPending` leaves those rows `pending` until that client exists.
