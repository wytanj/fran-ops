# Storage tiering: hot index, warm packs, versioned Supabase Storage objects, Drive context

Fran-ops keeps the ops bus lean. Media and archives do not live in Postgres. Each artifact has a hot index row, an optional warm markdown pack in git, and versioned file objects in **Supabase Storage**. Supabase Storage is the version store: retrieve/replace objects as the artifact evolves. Google Drive is for **contextual/organized files** and folder purpose/context so franbird can answer placement/context; it is not the version store. Slack is a recent human inbox, not the archive.

## Decision

| Tier | Where | Holds | Does not hold |
| --- | --- | --- | --- |
| HOT | Postgres (Supabase) | JIDs, timestamps, tags, staff/task links, `supabase_object_path`, and optional `drive_folder_id` / `drive_folders` links | Blobs, PDFs, WhatsApp media bytes, long quote packs, long-lived signed URLs |
| WARM (git) | git `contextpacks/` | Short curated `.md` for agent context | Fat media, full archival dumps |
| BLOBS (version store) | **Supabase Storage** | Versioned file objects for WA media, PDFs, archival packs, and fat artifacts; retrieve/replace as artifacts evolve | Agent-scanned bulk listing; humans pull via **signed URLs** minted at read time |
| Drive (context/placement) | Google Drive | Contextual/organized files and folder purpose/context; the index links `drive_folder_id` to `drive_folders` so franbird can answer placement/context | Version store / bulk archive |
| Slack | Allowlisted channels | Recent human media inbox | Long-term archive of WA / Storage content |

`migrations/002_storage_index.sql` adds `media_index`, `drive_folders`, and `contextpack_meta`. Those tables are index-only. The hot index links both stores when applicable: `media_index.supabase_object_path` points to the Supabase version-store object, while `media_index.drive_folder_id` links to the Google Drive folder-purpose/context row. There is no `bytea` column and no embedded payload column for file bytes. Signed URLs are **not** stored; mint them from `supabase_object_path` at read time.

## Consequences

- Ingest writes a warm pack under `contextpacks/` when a short summary helps agents, inserts a `media_index` row with `warm_pack_path` and/or `supabase_object_path`, and optionally links the related Drive context with `drive_folder_id`.
- Versioned file objects upload to **Supabase Storage** (stub TODO until bucket/policy exists). Retrieve/replace them there as the artifact evolves; the index stores the current object path and readers call a signed-URL helper at access time.
- Prune and rollup keep `contextpacks/` lean: keep recent days detailed, roll older days into monthly summaries, drop or archive oversized packs.
- Drive is used for contextual/organized files and folder purpose/context. Register folders via `drive_folders` (folder id, name, purpose, optional contextpack path); a media row may optionally link `drive_folder_id` when an artifact is associated with that placement context.
- Slack may receive a recent copy for humans. That copy is not the system of record for blobs.
- Supabase Storage bucket name/policy and Drive folder ids are JT-owned configuration. This scaffold uses placeholder storage paths until the bucket exists.

## Alternatives rejected

- Blobs in Postgres: breaks the bus index role and bloats Supabase.
- Everything in git: fat media and PDFs blow up the repo and PR review.
- Google Drive as the version store: Drive remains the contextual/organized placement layer, while Supabase Storage owns versioned file objects and retrieval/replacement.
- Storing signed URLs in the DB: they expire; store the object path and mint at read time.
- Agents scanning Drive or Storage buckets: slow, noisy, and couples context to listing quota.

See `docs/storage-tiers.md` for the operational layout and `src/storage.ts` for the TypeScript contract.
