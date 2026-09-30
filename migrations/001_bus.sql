-- fran-ops bus. Slack and Telegram share event_type. surface says which client.
-- staff_id is FranHRM public.staff.id copied by value. No cross-database foreign key.
-- channel_allowlist is a projection of src/allowlist.ts. Code is the source of truth.

begin;

create table staff_identities (
  staff_id uuid primary key,
  employment text not null check (employment in ('full_time', 'part_time')),
  slack_user_id text,
  telegram_user_id text,
  channel_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slack_user_id is null or length(btrim(slack_user_id)) > 0),
  check (telegram_user_id is null or length(btrim(telegram_user_id)) > 0)
);

create unique index staff_identities_slack_user_id_key
  on staff_identities (slack_user_id)
  where slack_user_id is not null;

create unique index staff_identities_telegram_user_id_key
  on staff_identities (telegram_user_id)
  where telegram_user_id is not null;

create table channel_allowlist (
  surface text not null check (surface in ('slack', 'telegram')),
  channel_id text not null check (length(btrim(channel_id)) > 0),
  name text not null check (length(btrim(name)) > 0),
  primary key (surface, channel_id)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'channel.message',
    'task.opened',
    'stamp.applied',
    'card.approved',
    'card.sent_back'
  )),
  surface text not null check (surface in ('slack', 'telegram')),
  actor_staff_id uuid references staff_identities (staff_id),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) > 0),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index events_actor_staff_id_idx on events (actor_staff_id);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  template_key text not null check (template_key in (
    'shift_open',
    'shift_close',
    'incident',
    'hand_off',
    'tell'
  )),
  title text not null check (length(btrim(title)) > 0),
  status text not null default 'open' check (status in (
    'open',
    'claimed',
    'blocked',
    'done',
    'handed_off',
    'escalated'
  )),
  channel_surface text not null,
  channel_id text not null,
  message_ref text,
  opener_staff_id uuid not null references staff_identities (staff_id),
  assignee_staff_id uuid references staff_identities (staff_id),
  briefing_required boolean not null default false,
  opened_event_id uuid not null unique references events (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (channel_surface, channel_id) references channel_allowlist (surface, channel_id),
  check (message_ref is null or length(btrim(message_ref)) > 0)
);

create unique index tasks_message_ref_key
  on tasks (channel_surface, channel_id, message_ref)
  where message_ref is not null;

create index tasks_channel_idx on tasks (channel_surface, channel_id);

create table stamps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id),
  kind text not null check (kind in (
    'claim',
    'done',
    'blocked',
    'hand_off',
    'escalate'
  )),
  staff_id uuid not null references staff_identities (staff_id),
  surface text not null check (surface in ('slack', 'telegram')),
  external_ref text not null check (length(btrim(external_ref)) > 0),
  event_id uuid not null unique references events (id),
  created_at timestamptz not null default now(),
  unique (surface, external_ref)
);

create index stamps_task_id_idx on stamps (task_id);

create table outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id),
  destination text not null check (destination in ('slack', 'telegram')),
  card_template text not null check (card_template in ('draft_for_approve', 'ack', 'dm_ack')),
  payload jsonb not null,
  status text not null default 'pending' check (status in (
    'pending',
    'publishing',
    'published',
    'failed'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (event_id, destination, card_template),
  check (
    (status = 'published' and published_at is not null)
    or (status <> 'published' and published_at is null)
  )
);

create index outbox_pending_idx on outbox (available_at)
  where status = 'pending';

create table summaries (
  id uuid primary key default gen_random_uuid(),
  surface text not null,
  channel_id text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  body text not null check (length(btrim(body)) > 0),
  through_event_id uuid references events (id),
  created_at timestamptz not null default now(),
  foreign key (surface, channel_id) references channel_allowlist (surface, channel_id),
  unique (surface, channel_id, period_start, period_end),
  check (period_end > period_start)
);

commit;
