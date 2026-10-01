# Storage tiering: hot index, warm packs, Supabase Storage blobs, Drive folder purpose

Fran-ops keeps the ops bus lean. Media and archives do not live in Postgres. Each artifact has a hot index row, an optional warm markdown pack in git, and fat blobs in **Supabase Storage**. Google Drive is for **organized human folders** (purpose/context), not the main blob dump. Slack is a recent human inbox, not the archive.

## Decision

| Tier | Where | Holds | Does not hold |
| --- | --- | --- | --- |
| HOT | Supabase / Postgres | JIDs, timestamps, tags, staff/task links, Supabase Storage object paths, optional Drive folder links | Blobs, PDFs, WhatsApp media bytes, long quote packs, long-lived signed URLs |
| WARM (git) | git `contextpacks/` | Short curated `.md` for agent context | Fat media, full archival dumps |
| BLOBS (cold/warm objects) | **Supabase Storage** | WA media, PDFs, archival packs, fat artifacts — primary dump | Agent-scanned bulk listing; humans pull via **signed URLs** minted at read time |
| Drive (human folders) | Google Drive | Organized folders humans use; index stores **folder ids + purpose/context** so franbird can answer “what was this folder for?” | Bulk blob store / main dump |
| Slack | Allowlisted channels | Recent human media inbox | Long-term archive of WA / Storage content |

`migrations/002_storage_index.sql` adds `media_index`, `drive_folders`, and `contextpack_meta`. Those tables are index-only. There is no `bytea` column and no embedded payload column for file bytes. Signed URLs are **not** stored; mint them from `supabase_object_path` at read time.

## Consequences

- Ingest writes a warm pack under `contextpacks/` when a short summary helps agents, inserts a `media_index` row with `warm_pack_path` and/or `supabase_object_path`, and never stores the blob in Postgres.
- Fat objects upload to **Supabase Storage** (stub TODO until bucket/policy exists). The index stores the object path (bucket + path); readers call a signed-URL helper at access time.
- Prune and rollup keep `contextpacks/` lean: keep recent days detailed, roll older days into monthly summaries, drop or archive oversized packs.
- Drive is registered via `drive_folders` (folder id, name, purpose, optional contextpack path). A media row may optionally link `drive_folder_id` when an artifact is *associated* with a human folder — that is not where the blob lives.
- Slack may receive a recent copy for humans. That copy is not the system of record for blobs.
- Supabase Storage bucket name/policy and Drive folder ids are JT-owned configuration. This scaffold uses placeholder storage paths until the bucket exists.

## Alternatives rejected

- Blobs in Postgres: breaks the bus index role and bloats Supabase.
- Everything in git: fat media and PDFs blow up the repo and PR review.
- Google Drive as the main dump: couples archive to Drive listing quota and share-link churn; Drive stays human folder organization + purpose index.
- Storing signed URLs in the DB: they expire; store the object path and mint at read time.
- Agents scanning Drive or Storage buckets: slow, noisy, and couples context to listing quota.

See `docs/storage-tiers.md` for the operational layout and `src/storage.ts` for the TypeScript contract.
