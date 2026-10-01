# Storage tiers (ops guide)

Standing rules are in `docs/adr/0003-storage-tiering.md`. This page is how to place and prune artifacts day to day.

## What goes where

| Kind of data | Tier | Location |
| --- | --- | --- |
| JIDs, timestamps, tags, staff/task FKs, pointers | HOT | `media_index` (and related bus tables) |
| Short curated agent notes | WARM | `contextpacks/**/*.md` |
| Fat PDFs, full WA media, archival quote packs | COLD | Google Drive (or object bucket) URI on `media_index.cold_uri` |
| Recent human-facing media | Slack inbox | Allowlisted Slack channel; not the archive |

Postgres never stores blobs. If a column would hold bytes, put a pointer instead.

## Ingest layout

1. Capture the external ref (WhatsApp JID / message id, Slack file id, upload id, agent run id).
2. If a short agent summary helps, write a warm `.md` under `contextpacks/<source>/…` using relative paths only (see `src/storage.ts`).
3. Insert a `media_index` row with:
   - `source` ∈ `whatsapp` | `slack` | `telegram` | `upload` | `agent`
   - `external_jid` / ref
   - `occurred_at`, `tags`
   - optional `staff_id`, `task_id`
   - `warm_pack_path` when a pack was written
   - `cold_uri` when the fat object exists (Drive/https)
   - optional `slack_file_ref`, `mime_hint`, `bytes_hint`, `notes`
4. Do **not** upload to Drive or Slack inside the scaffold stubs. `src/wacli/ingest.ts` returns payloads with TODO placeholders.

WhatsApp path convention (warm):

```text
contextpacks/wa/YYYY/MM/DD/<external-ref-slug>.md
```

## Drive pointer convention (cold)

Until JT supplies a shared Drive folder, use a placeholder URI shape:

```text
drive://PENDING/<source>/<external-ref>
```

or a future HTTPS share link once the folder exists:

```text
https://drive.google.com/file/d/<fileId>/view
```

Agents open `cold_uri` from the index. They do not scan the Drive folder or bucket.

## Prune / rollup for `contextpacks/`

Keep the repo lean:

| Horizon | Action |
| --- | --- |
| Last 7 days | Keep detailed daily packs |
| Days 8–31 | Optional: compress to one daily summary per day |
| Older than ~1 month | Roll into `contextpacks/<source>/YYYY-MM.md` monthly summaries; delete or cold-archive the detailed day files |
| Any single pack | Prefer under ~8 KiB of prose; move fat excerpts to cold and leave a pointer |

`contextpack_meta` (optional table in `002_storage_index.sql`) tracks `path`, `kind`, `last_rolled_at`, and `bytes_approx` so a later job can prune without walking git history.

Update `contextpack_meta.last_rolled_at` when a rollup rewrites or replaces packs.

## Slack role

Slack is the recent human media inbox. A WA ingest may later post a recent copy for humans; that Slack file is not the cold archive. Long retention lives in Drive (cold) with the hot index pointing at it.

## Related code

- Types and helpers: `src/storage.ts`
- WA stubs: `src/wacli/`
- Warm rules: `contextpacks/README.md`
- Migration: `migrations/002_storage_index.sql` (do not apply from a kicked session without JT saying yes)
