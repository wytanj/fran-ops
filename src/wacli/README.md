# wacli stubs

Scaffold for WhatsApp → fran-ops storage tiers. **No Slack or WA secrets are required for this PR.**

## What this folder does

| File | Role |
| --- | --- |
| `types.ts` | WA message / media ref shapes |
| `ingest.ts` | Build a short warm `.md` under `contextpacks/wa/…` and a `media_index` insert payload with a **placeholder** `cold_uri` |

Ingest does **not**:

- upload to Google Drive
- post to Slack
- talk to a live WhatsApp session

## Run later (when wiring a real importer)

1. JT shares a Drive folder for cold objects (replace `drive://PENDING/…` from `placeholderColdUri`).
2. Apply `migrations/002_storage_index.sql` only after JT says yes in his own words (class D).
3. Point a small CLI or agent step at `ingestWaMedia` / `ingestWaText`, write the returned markdown with `writeWarmPack`, then `recordMediaIndex` with a real `db.query`.
4. Slack recent-inbox copy stays blocked on the Slack install from PR #1; this scaffold does not need those tokens.

## Tiers reminder

- **HOT** — `media_index` row only (JIDs, tags, pointers).
- **WARM** — git `contextpacks/wa/…`.
- **COLD** — Drive/bucket; agents open by link, never scan the bucket.
- **Slack** — recent human inbox, not the archive.

See `docs/storage-tiers.md` and `docs/adr/0003-storage-tiering.md`.
