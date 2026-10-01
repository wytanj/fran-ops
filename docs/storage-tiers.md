# Storage tiers (ops guide)

Standing rules are in `docs/adr/0003-storage-tiering.md`. This page is how to place and prune artifacts day to day.

## What goes where

| Kind of data | Tier | Location |
| --- | --- | --- |
| JIDs, timestamps, tags, staff/task FKs, Storage object paths, Drive folder links | HOT | `media_index` (and related bus tables) |
| Short curated agent notes | WARM (git) | `contextpacks/**/*.md` |
| Fat PDFs, full WA media, archival quote packs | BLOBS | **Supabase Storage**; path on `media_index.supabase_object_path`; humans pull via signed URLs at read time |
| Human folder purpose / context | Drive index | `drive_folders` (folder id + purpose); optional `media_index.drive_folder_id` association |
| Recent human-facing media | Slack inbox | Allowlisted Slack channel; not the archive |

Postgres never stores blobs. Signed URLs are minted at read time from the stored object path — do not persist them. If a column would hold bytes, put a Storage path instead.

## Ingest layout

1. Capture the external ref (WhatsApp JID / message id, Slack file id, upload id, agent run id).
2. If a short agent summary helps, write a warm `.md` under `contextpacks/<source>/…` using relative paths only (see `src/storage.ts`).
3. Upload the fat object to **Supabase Storage** when available (stub TODO in wacli); record `supabase_object_path` (bucket + path).
4. Insert a `media_index` row with:
   - `source` — `whatsapp` | `slack` | `telegram` | `upload` | `agent`
   - `external_jid` / ref
   - `occurred_at`, `tags`
   - optional `staff_id`, `task_id`
   - `warm_pack_path` when a pack was written
   - `supabase_object_path` when the blob exists in Supabase Storage
   - optional `drive_folder_id` when associated with a human Drive folder (not the blob location)
   - optional `slack_file_ref`, `mime_hint`, `bytes_hint`, `notes`
5. Do **not** upload to Drive as the primary dump. `src/wacli/ingest.ts` returns payloads with Storage path placeholders and TODOs.
6. Optionally register a Drive folder purpose row via `drive_folders` when JT shares a human folder id + purpose.

WhatsApp path convention (warm git):

```text
contextpacks/wa/YYYY/MM/DD/<external-ref-slug>.md
```

## Supabase Storage path convention (blobs)

Until JT supplies a bucket name/policy, use a placeholder object path shape:

```text
pending/<source>/<external-ref>
```

Helpers build `supabase_object_path` as `bucket/objectKey` (see `buildSupabaseObjectPath` in `src/storage.ts`). Default bucket placeholder is `fran-ops-media` until configured.

At read time, call `mintSignedUrl(supabase_object_path)` (stub TODO — needs `SUPABASE_URL` + service role). Do **not** store the signed URL in Postgres.

## Drive folder purpose (not the dump)

Register human folders in `drive_folders`:

| Column | Role |
| --- | --- |
| `folder_id` | Google Drive folder id (PK) |
| `name` | Display name |
| `purpose` | Human-readable what this folder is for (required) |
| `contextpack_path` | Optional warm `.md` that explains the folder |
| `parent_folder_id` | Optional parent |
| `staff_id` / tags | Optional |

franbird answers “what was this folder used for?” from `purpose` (+ warm pack). Link folders from `media_index.drive_folder_id` when an artifact is associated with that human folder. **Do not** treat Drive as the bulk blob store.

## Prune / rollup for `contextpacks/`

Keep the repo lean:

| Horizon | Action |
| --- | --- |
| Last 7 days | Keep detailed daily packs |
| Days 8–31 | Optional: compress to one daily summary per day |
| Older than ~1 month | Roll into `contextpacks/<source>/YYYY-MM.md` monthly summaries; delete or Storage-archive the detailed day files |
| Any single pack | Prefer under ~8 KiB of prose; move fat excerpts to Supabase Storage and leave a pointer |

`contextpack_meta` (optional table in `002_storage_index.sql`) tracks `path`, `kind`, `last_rolled_at`, and `bytes_approx` so a later job can prune without walking git history.

Update `contextpack_meta.last_rolled_at` when a rollup rewrites or replaces packs.

## Slack role

Slack is the recent human media inbox. A WA ingest may later post a recent copy for humans; that Slack file is not the blob archive. Long retention lives in **Supabase Storage** with the hot index pointing at the object path.

## Related code

- Types and helpers: `src/storage.ts`
- WA stubs: `src/wacli/`
- Warm rules: `contextpacks/README.md`
- Migration: `migrations/002_storage_index.sql` (do not apply from a kicked session without JT saying yes)
