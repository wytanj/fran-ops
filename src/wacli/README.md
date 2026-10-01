# wacli stubs

Scaffold for WhatsApp → fran-ops storage tiers. **No Slack secrets are required for this scaffold.**

## Env hints (later wiring)

| Var | Required now | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | no (later) | Project URL for Storage upload / signed URL mint |
| Supabase service role key | no (later) | Server-side Storage access; never commit |
| Slack tokens | no | Not needed for this storage-tiering scaffold (#1 is separate) |

## What this folder does

| File | Role |
| --- | --- |
| `types.ts` | WA message / media ref shapes |
| `ingest.ts` | Build a short warm `.md` under `contextpacks/wa/…` and a `media_index` insert with a **placeholder** `supabase_object_path`; optional Drive folder purpose stub |

Ingest does **not**:

- upload to Supabase Storage yet (TODO stub)
- upload to Google Drive as the version store or bulk dump (Drive is contextual/organized placement)
- post to Slack
- talk to a live WhatsApp session

## Run later (when wiring a real importer)

1. JT configures Supabase Storage bucket name/policy (replace placeholder paths from `placeholderSupabaseObjectPath` / `buildSupabaseObjectPath`).
2. Apply `migrations/002_storage_index.sql` only after JT says yes in his own words (class D).
3. Point a small CLI or agent step at `ingestWaMedia` / `ingestWaText`, write the returned markdown with `writeWarmPack`, upload via `uploadToSupabaseStorage` when ready, then `recordMediaIndex` with a real `db.query`.
4. Optionally register contextual/organized Google Drive folders with `linkDriveFolderPurpose` + `recordDriveFolder` (folder id + purpose -- not the version store).
5. Slack recent-inbox copy stays blocked on the Slack install from PR #1; this scaffold does not need those tokens.

## Tiers reminder

- **HOT** — `media_index` row only (JIDs, tags, Supabase object paths, optional Drive folder links). No long-lived signed URLs.
- **WARM** — git `contextpacks/wa/…`.
- **VERSION STORE** -- Supabase Storage versioned file objects; retrieve/replace as needed, humans pull via signed URLs minted at read time; agents open by path, never scan the bucket.
- **Drive** -- contextual/organized files and folder purpose/placement index (`drive_folders`), linked from `media_index.drive_folder_id`; not the version store.
- **Slack** — recent human inbox, not the archive.

See `docs/storage-tiers.md` and `docs/adr/0003-storage-tiering.md`.
