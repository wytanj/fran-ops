-- Additive: Slack/user-facing display name on staff_identities.
-- Does not rewrite 001_bus.sql. Nullable so live rows stay valid.
-- Cards prefer display_name, then Slack mention, then short staff id.

begin;

alter table staff_identities
  add column display_name text
  check (display_name is null or length(btrim(display_name)) > 0);

comment on column staff_identities.display_name is
  'Slack/user-facing display name (FranHRM or ops). Nullable; cards fall back to Slack mention or short staff id.';

commit;