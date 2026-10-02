-- Bill-split / Splitwise-lite. Single SoT for Slack + Telegram.
-- Additive: does not rewrite 001–003. Balances are derived in code (see src/bill_math.ts);
-- this migration stores expenses, shares, and settle events only.
-- Class D on droplet: apply only after JT yes.

begin;

-- Extend outbox card templates for bill-split surfaces.
alter table outbox drop constraint if exists outbox_card_template_check;
alter table outbox add constraint outbox_card_template_check check (card_template in (
  'draft_for_approve',
  'ack',
  'dm_ack',
  'expense_confirm',
  'tally',
  'settle_ack'
));

create table bill_expenses (
  id uuid primary key default gen_random_uuid(),
  payer_staff_id uuid not null references staff_identities (staff_id),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'SGD' check (length(btrim(currency)) = 3),
  merchant text check (merchant is null or length(btrim(merchant)) > 0),
  note text check (note is null or length(btrim(note)) > 0),
  split_mode text not null default 'equal' check (split_mode in ('equal', 'exact')),
  status text not null default 'pending_confirm' check (status in (
    'pending_confirm',
    'confirmed',
    'void'
  )),
  surface text not null check (surface in ('slack', 'telegram')),
  channel_id text not null check (length(btrim(channel_id)) > 0),
  thread_ref text check (thread_ref is null or length(btrim(thread_ref)) > 0),
  media_index_id uuid,
  receipt_uri text check (receipt_uri is null or length(btrim(receipt_uri)) > 0),
  parse_confidence text not null default 'high' check (parse_confidence in ('high', 'ambiguous')),
  created_by_staff_id uuid not null references staff_identities (staff_id),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) > 0),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'confirmed' and confirmed_at is not null)
    or (status <> 'confirmed')
  )
);

create index bill_expenses_channel_idx
  on bill_expenses (surface, channel_id, created_at desc);
create index bill_expenses_payer_idx on bill_expenses (payer_staff_id);
create index bill_expenses_status_idx on bill_expenses (status);

comment on table bill_expenses is
  'Bill-split expense. Ambiguous parses stay pending_confirm until approval card.';
comment on column bill_expenses.receipt_uri is
  'Pointer only (slack file ref or supabase object path). No blobs.';

create table bill_shares (
  expense_id uuid not null references bill_expenses (id) on delete cascade,
  staff_id uuid not null references staff_identities (staff_id),
  share_cents bigint not null check (share_cents >= 0),
  primary key (expense_id, staff_id)
);

create index bill_shares_staff_idx on bill_shares (staff_id);

comment on table bill_shares is
  'Per-staff share of one expense. Sum(share_cents) must equal amount_cents (enforced in app).';

create table bill_settlements (
  id uuid primary key default gen_random_uuid(),
  from_staff_id uuid not null references staff_identities (staff_id),
  to_staff_id uuid not null references staff_identities (staff_id),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'SGD' check (length(btrim(currency)) = 3),
  note text check (note is null or length(btrim(note)) > 0),
  surface text not null check (surface in ('slack', 'telegram')),
  channel_id text not null check (length(btrim(channel_id)) > 0),
  thread_ref text check (thread_ref is null or length(btrim(thread_ref)) > 0),
  created_by_staff_id uuid not null references staff_identities (staff_id),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) > 0),
  created_at timestamptz not null default now(),
  check (from_staff_id <> to_staff_id)
);

create index bill_settlements_channel_idx
  on bill_settlements (surface, channel_id, created_at desc);
create index bill_settlements_from_idx on bill_settlements (from_staff_id);
create index bill_settlements_to_idx on bill_settlements (to_staff_id);

comment on table bill_settlements is
  'Settle event: from_staff paid to_staff amount_cents (reduces derived balance).';

commit;
