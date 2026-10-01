# contextpacks (warm tier)

Short curated markdown for agent context. This is the **warm (git)** storage tier.

Standing rules: `docs/adr/0003-storage-tiering.md` and `docs/storage-tiers.md`.

## Rules

1. Keep packs lean. Prefer under ~8 KiB of prose per file.
2. Paths are git-relative and start with `contextpacks/`. No absolute paths, no `..`.
3. Fat PDFs, full WhatsApp media, and archival quote packs go to **Supabase Storage** as versioned file objects (the version store). Retrieve/replace them as the artifact evolves; put the object path in the pack and on `media_index.supabase_object_path`. Mint signed URLs at read time -- do not store them.
4. Google Drive is for **contextual/organized files** and folder purpose/placement context (`drive_folders`), not the version store. Link an artifact with `media_index.drive_folder_id` when applicable.
5. Postgres holds the **hot** index only (`media_index`): it links the Supabase version object and optional Google Drive context, never blobs.

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
| Older than ~1 month | Roll into `wa/YYYY-MM.md`; remove or Storage-archive day files |
| Oversized pack | Move fat excerpts to Supabase Storage; leave pointers in a short warm file |

Optional table `contextpack_meta` in `migrations/002_storage_index.sql` tracks path, kind, `last_rolled_at`, and `bytes_approx` for automated prune later.

## Writing packs

Use `buildWarmPackMarkdown` and `warmWaPackPath` from `src/storage.ts`. WA ingest stubs live in `src/wacli/`.
