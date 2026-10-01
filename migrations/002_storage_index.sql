-- fran-ops storage index. Hot tier only: JIDs, timestamps, tags, staff/task links, pointers.
-- No bytea / blob columns. Warm packs live in git contextpacks/. Cold objects live in Drive (or bucket).
-- Does not rewrite 001_bus.sql.

begin;

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
  cold_uri text check (
    cold_uri is null
    or (
      length(btrim(cold_uri)) > 0
      and (
        cold_uri like 'https://%'
        or cold_uri like 'http://%'
        or cold_uri like 'drive://%'
        or cold_uri like 'gs://%'
        or cold_uri like 's3://%'
      )
    )
  ),
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
    or cold_uri is not null
    or slack_file_ref is not null
  )
);

create index media_index_occurred_at_idx on media_index (occurred_at);
create index media_index_tags_gin_idx on media_index using gin (tags);
create index media_index_staff_id_idx on media_index (staff_id);
create index media_index_task_id_idx on media_index (task_id);
create index media_index_source_idx on media_index (source);

create unique index media_index_source_external_jid_key
  on media_index (source, external_jid);

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

commit;
