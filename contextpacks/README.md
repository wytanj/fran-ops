# contextpacks (warm tier)

Short curated markdown for agent context. This is the **warm** storage tier.

Standing rules: `docs/adr/0003-storage-tiering.md` and `docs/storage-tiers.md`.

## Rules

1. Keep packs lean. Prefer under ~8 KiB of prose per file.
2. Paths are git-relative and start with `contextpacks/`. No absolute paths, no `..`.
3. Fat PDFs, full WhatsApp media, and archival quote packs go **cold** (Drive / bucket). Put the link in the pack and on `media_index.cold_uri`.
4. Postgres holds the **hot** index only (`media_index`), never blobs.

## Layout

```text
contextpacks/
  README.md          # this file
  NEXT.md            # upcoming slices
  wa/                # WhatsApp warm packs
    _example.md
    YYYY/MM/DD/<slug>.md
  wa/YYYY-MM.md      # monthly rollups (after prune)
```

## Prune / rollup plan

| Horizon | Action |
| --- | --- |
| Last 7 days | Keep detailed daily packs under `wa/YYYY/MM/DD/` |
| Older than ~1 month | Roll into `wa/YYYY-MM.md`; remove or cold-archive day files |
| Oversized pack | Move fat excerpts to cold; leave pointers in a short warm file |

Optional table `contextpack_meta` in `migrations/002_storage_index.sql` tracks path, kind, `last_rolled_at`, and `bytes_approx` for automated prune later.

## Writing packs

Use `buildWarmPackMarkdown` and `warmWaPackPath` from `src/storage.ts`. WA ingest stubs live in `src/wacli/`.
