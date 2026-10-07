-- Device identity and its timeline. Both tables are insert-only.
-- Out of warranty is an event. It does not delete the asset or earlier events.
-- Class D on the droplet. Apply only after JT says yes.

begin;

create table assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,31}$'),
  serial text not null unique check (serial ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  aliases jsonb not null default '[]'::jsonb check (jsonb_typeof(aliases) = 'array'),
  site text check (site is null or length(btrim(site)) > 0),
  notes text check (notes is null or length(btrim(notes)) > 0),
  created_at timestamptz not null default now()
);

create table asset_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  asset_id uuid not null references assets (id),
  event_type text not null check (event_type in (
    'crack',
    'claim_filed',
    'oow',
    'repair',
    'swap',
    'retire'
  )),
  issue_id uuid references issues (id),
  at timestamptz not null default clock_timestamp(),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  actor text not null check (actor in ('bot', 'staff')),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) > 0)
);

create index asset_events_asset_seq_idx on asset_events (asset_id, seq);

create function forbid_asset_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'asset history is append-only';
end;
$$;

create trigger assets_append_only
  before update or delete on assets
  for each row
  execute function forbid_asset_history_mutation();

create trigger asset_events_append_only
  before update or delete on asset_events
  for each row
  execute function forbid_asset_history_mutation();

commit;
