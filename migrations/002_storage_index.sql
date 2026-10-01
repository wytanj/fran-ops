-- fran-ops storage index. Hot tier only: JIDs, timestamps, tags, staff/task links, pointers.
-- No bytea / blob columns. Warm packs live in git contextpacks/.
-- Blobs live in Supabase Storage (primary cold/warm object store). Index stores object paths only;
-- signed URLs are minted at read time and must NOT be persisted (they expire).
-- Drive rows (drive_folders) are folder purpose / context only — NOT the bulk blob dump.
-- Does not rewrite 001_bus.sql.

begin;

-- Human Drive folders: purpose index so franbird can answer "what was this folder for?"
-- Do not use Drive as the primary blob store; blobs go to Supabase Storage.
create table drive_folders (
  folder_id text primary key check (length(btrim(folder_id)) > 0),
  name text not null check (length(btrim(name)) > 0),
  purpose text not null check (length(btrim(purpose)) > 0),
  contextpack_path text check (
    contextpack_path is null
    or (
      length(btrim(contextpack_path)) > 0
      and contextpack_path not like '/%'
      and position('..' in contextpack_path) = 0
      and contextpack_path like 'contextpacks/%'
    )
  ),
  parent_folder_id text references drive_folders (folder_id),
  staff_id uuid references staff_identities (staff_id),
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index drive_folders_staff_id_idx on drive_folders (staff_id);
create index drive_folders_parent_folder_id_idx on drive_folders (parent_folder_id);
create index drive_folders_tags_gin_idx on drive_folders using gin (tags);

comment on table drive_folders is
  'Google Drive folder purpose index only. Blobs live in Supabase Storage, not Drive.';
comment on column drive_folders.purpose is
  'Human-readable what this folder is for (franbird context).';
comment on column drive_folders.contextpack_path is
  'Optional git-relative warm .md that explains the folder.';

create table media_index (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in (
    'whatsapp',
    'slack',
    'telegram',
    'upload',
    'agent'
  )),
  external_jid text not null check (length(btrim(external_jid)) > 0),
  occurred_at timestamptz not null,
  tags text[] not null default '{}'::text[],
  staff_id uuid references staff_identities (staff_id),
  task_id uuid references tasks (id),
  warm_pack_path text check (
    warm_pack_path is null
    or (
      length(btrim(warm_pack_path)) > 0
      and warm_pack_path not like '/%'
      and position('..' in warm_pack_path) = 0
      and warm_pack_path like 'contextpacks/%'
    )
  ),
  -- Primary blob pointer: Supabase Storage object path (bucket + path). No long-lived signed URL.
  supabase_object_path text check (
    supabase_object_path is null
    or (
      length(btrim(supabase_object_path)) > 0
      and supabase_object_path not like '/%'
      and position('..' in supabase_object_path) = 0
    )
  ),
  -- Optional association with a human Drive folder (NOT the blob location).
  drive_folder_id text references drive_folders (folder_id),
  slack_file_ref text check (
    slack_file_ref is null
    or length(btrim(slack_file_ref)) > 0
  ),
  mime_hint text check (
    mime_hint is null
    or length(btrim(mime_hint)) > 0
  ),
  bytes_hint bigint check (
    bytes_hint is null
    or bytes_hint >= 0
  ),
  notes text check (
    notes is null
    or length(btrim(notes)) > 0
  ),
  created_at timestamptz not null default now(),
  check (
    warm_pack_path is not null
    or supabase_object_path is not null
    or slack_file_ref is not null
  )
);

comment on table media_index is
  'Hot index only. Blobs live in Supabase Storage; signed URLs minted at read time from supabase_object_path.';
comment on column media_index.supabase_object_path is
  'Supabase Storage object path (bucket/key). Do not store signed URLs — they expire.';
comment on column media_index.drive_folder_id is
  'Optional link to a human Drive folder purpose row; not the blob store location.';

create index media_index_occurred_at_idx on media_index (occurred_at);
create index media_index_tags_gin_idx on media_index using gin (tags);
create index media_index_staff_id_idx on media_index (staff_id);
create index media_index_task_id_idx on media_index (task_id);
create index media_index_source_idx on media_index (source);
create index media_index_drive_folder_id_idx on media_index (drive_folder_id);
create index media_index_supabase_object_path_idx on media_index (supabase_object_path);

create unique index media_index_source_external_jid_key
  on media_index (source, external_jid);

-- Optional warm-tier prune metadata (git contextpacks/ only).
create table contextpack_meta (
  path text primary key check (
    length(btrim(path)) > 0
    and path not like '/%'
    and position('..' in path) = 0
    and path like 'contextpacks/%'
  ),
  kind text not null check (kind in (
    'daily',
    'monthly',
    'rollup',
    'example',
    'other'
  )),
  last_rolled_at timestamptz,
  bytes_approx bigint check (
    bytes_approx is null
    or bytes_approx >= 0
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table contextpack_meta is
  'Optional metadata for warm git contextpacks/ prune and rollup.';

commit;
