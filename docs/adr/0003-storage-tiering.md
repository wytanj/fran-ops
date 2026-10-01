# Storage tiering: hot index, warm packs, cold objects

Fran-ops keeps the ops bus lean. Media and archives do not live in Postgres. Each artifact has a hot index row, an optional warm markdown pack in git, and an optional cold object behind a Drive or HTTPS pointer. Slack is a recent human inbox, not the archive.

## Decision

| Tier | Where | Holds | Does not hold |
| --- | --- | --- | --- |
| HOT | Supabase / Postgres | JIDs, timestamps, tags, staff/task links, pointers to Drive / Slack / git | Blobs, PDFs, WhatsApp media bytes, long quote packs |
| WARM | git `contextpacks/` | Short curated `.md` for agent context | Fat media, full archival dumps |
| COLD | Google Drive (or object bucket) | Fat PDFs, full WA media, archival quote packs | Agent-scanned bulk; agents open by link from the index |
| Slack | Allowlisted channels | Recent human media inbox | Long-term archive of WA / Drive content |

`migrations/002_storage_index.sql` adds `media_index` and `contextpack_meta`. Those tables are index-only. There is no `bytea` column and no embedded payload column for file bytes.

## Consequences

- Ingest writes a warm pack under `contextpacks/` when a short summary helps agents, inserts a `media_index` row with `warm_pack_path` and/or `cold_uri`, and never stores the blob in Postgres.
- Prune and rollup keep `contextpacks/` lean: keep recent days detailed, roll older days into monthly summaries, drop or archive oversized packs.
- Cold objects are opened by link. Agents do not list or scan the bucket.
- Slack may receive a recent copy for humans. That copy is not the system of record for cold storage.
- Drive folder IDs and share links are JT-owned configuration. This scaffold uses placeholder `cold_uri` values until that folder exists.

## Alternatives rejected

- Blobs in Postgres: breaks the bus index role and bloats Supabase.
- Everything in git: fat media and PDFs blow up the repo and PR review.
- Agents scanning Drive: slow, noisy, and couples context to Drive listing quota.

See `docs/storage-tiers.md` for the operational layout and `src/storage.ts` for the TypeScript contract.
