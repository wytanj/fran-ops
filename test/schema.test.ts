import { expect, test } from "bun:test";
import {
  CARD_TEMPLATES,
  EMPLOYMENTS,
  EVENT_TYPES,
  OUTBOX_STATUSES,
  STAMP_KINDS,
  SURFACES,
  TASK_STATUSES,
  TASK_TEMPLATE_KEYS,
  parseStaffId,
} from "../src/domain.ts";
import { freshDb, migrationSql } from "./harness.ts";

const staffA = parseStaffId("11111111-1111-4111-8111-111111111111");
const staffB = parseStaffId("22222222-2222-4222-8222-222222222222");
if (staffA === null || staffB === null) throw new Error("fixture staff ids");

function expectLiterals(values: readonly string[]) {
  for (const value of values) {
    expect(migrationSql.includes(`'${value}'`)).toBe(true);
  }
}

test("migration names the seven bus tables and the shared literals", async () => {
  expectLiterals(EVENT_TYPES);
  expectLiterals(SURFACES);
  expectLiterals(EMPLOYMENTS);
  expectLiterals(STAMP_KINDS);
  expectLiterals(TASK_TEMPLATE_KEYS);
  expectLiterals(TASK_STATUSES);
  expectLiterals(CARD_TEMPLATES);
  expectLiterals(OUTBOX_STATUSES);
  expect(migrationSql.includes("'slack.task.opened'")).toBe(false);

  const db = await freshDb();
  const tables = await db.query<{ table_name: string }>(
    `select table_name
     from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`,
  );
  expect(tables.map((row) => row.table_name)).toEqual([
    "channel_allowlist",
    "events",
    "outbox",
    "staff_identities",
    "stamps",
    "summaries",
    "tasks",
  ]);
});

test("one staff row holds both surface ids", async () => {
  const db = await freshDb();
  await db.query(
    `insert into staff_identities (staff_id, employment, slack_user_id, telegram_user_id)
     values ($1, 'part_time', 'U0STAFF01', '555001')`,
    [staffA],
  );
  const bySlack = await db.query<{ staff_id: string }>(
    `select staff_id from staff_identities where slack_user_id = 'U0STAFF01'`,
  );
  const byTelegram = await db.query<{ staff_id: string }>(
    `select staff_id from staff_identities where telegram_user_id = '555001'`,
  );
  expect(bySlack[0]?.staff_id).toBe(staffA);
  expect(byTelegram[0]?.staff_id).toBe(staffA);

  await expect(
    db.query(
      `insert into staff_identities (staff_id, employment, slack_user_id)
       values ($1, 'full_time', 'U0STAFF01')`,
      [staffB],
    ),
  ).rejects.toThrow();
});

test("database rejects a third employment, a blank surface id, and a surface-specific event type", async () => {
  const db = await freshDb();
  await expect(
    db.query(`insert into staff_identities (staff_id, employment) values ($1, 'contractor')`, [staffA]),
  ).rejects.toThrow();
  await expect(
    db.query(
      `insert into staff_identities (staff_id, employment, slack_user_id) values ($1, 'full_time', '')`,
      [staffA],
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      `insert into events (event_type, surface, idempotency_key)
       values ('slack.task.opened', 'slack', 'k1')`,
    ),
  ).rejects.toThrow();
});

test("telegram can store the same event type Slack uses", async () => {
  const db = await freshDb();
  await db.query(
    `insert into staff_identities (staff_id, employment, telegram_user_id)
     values ($1, 'full_time', '555001')`,
    [staffA],
  );
  const events = await db.query<{ id: string }>(
    `insert into events (event_type, surface, actor_staff_id, idempotency_key)
     values ('task.opened', 'telegram', $1, 'tg-open-1')
     returning id`,
    [staffA],
  );
  const eventId = events[0]?.id;
  expect(eventId).toBeTruthy();
  const outbox = await db.query<{ destination: string }>(
    `insert into outbox (event_id, destination, card_template, payload)
     values ($1, 'telegram', 'draft_for_approve', '{"channelId":"1","taskId":"t","text":"Open shift","blocks":[]}'::jsonb)
     returning destination`,
    [eventId],
  );
  expect(outbox[0]?.destination).toBe("telegram");
});

test("summaries require a real allowlisted channel and a forward period", async () => {
  const db = await freshDb();
  await db.query(
    `insert into channel_allowlist (surface, channel_id, name) values ('slack', 'C0OPS01', 'ops')`,
  );
  await expect(
    db.query(
      `insert into summaries (surface, channel_id, period_start, period_end, body)
       values ('slack', 'C0OPS01', '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z', 'day')`,
    ),
  ).rejects.toThrow();
  const rows = await db.query<{ id: string }>(
    `insert into summaries (surface, channel_id, period_start, period_end, body)
     values ('slack', 'C0OPS01', '2026-09-30T00:00:00Z', '2026-10-01T00:00:00Z', 'day')
     returning id`,
  );
  expect(rows[0]?.id).toBeTruthy();
});
