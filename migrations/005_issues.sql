-- Issue ledger, separate from tasks. id is the issue id.
-- evidence grows by concatenation only.
-- Class D on the droplet: apply only after JT says yes.

begin;

alter table events drop constraint if exists events_event_type_check;
alter table events add constraint events_event_type_check check (event_type in (
  'channel.message',
  'task.opened',
  'stamp.applied',
  'card.approved',
  'card.sent_back',
  'issue.raised',
  'issue.approved',
  'issue.sent_back'
));

alter table outbox drop constraint if exists outbox_card_template_check;
alter table outbox add constraint outbox_card_template_check check (card_template in (
  'draft_for_approve',
  'ack',
  'dm_ack',
  'expense_confirm',
  'tally',
  'settle_ack',
  'issue_approve'
));

create table issues (
  id uuid primary key default gen_random_uuid(),
  playbook text not null check (playbook in ('hardware')),
  status text not null check (status in (
    'open',
    'waiting_approve',
    'in_progress',
    'blocked',
    'done'
  )),
  raiser_staff_id uuid not null references staff_identities (staff_id),
  approver_staff_id uuid not null references staff_identities (staff_id),
  payload jsonb not null,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  surface text not null check (surface = 'slack'),
  channel_id text not null check (length(btrim(channel_id)) > 0),
  thread_ts text not null check (length(btrim(thread_ts)) > 0),
  raise_event_id uuid not null unique references events (id),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (surface, channel_id) references channel_allowlist (surface, channel_id)
);

create index issues_status_idx on issues (status);

commit;
