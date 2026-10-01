import { findGrant, type ChannelGrant } from "./allowlist.ts";
import { ackCard, draftForApproveCard, franbirdTellCard } from "./cards.ts";
import type { Db, Query } from "./db.ts";
import {
  STAMP_TO_STATUS,
  TASK_STATUSES,
  TASK_TEMPLATES,
  formatStaffLabel,
  parseStaffId,
  type ChannelId,
  type Employment,
  type EventType,
  type Result,
  type SlackUserId,
  type StaffId,
  type StampKind,
  type Surface,
  type TaskId,
  type TaskStatus,
  type BriefingMode,
  type TaskTemplateKey,
  type TelegramUserId,
} from "./domain.ts";

const SURFACE_USER_COLUMN = {
  slack: "slack_user_id",
  telegram: "telegram_user_id",
} as const satisfies Record<Surface, string>;

export type StaffLink = {
  staffId: StaffId;
  employment: Employment;
  slackUserId: SlackUserId | null;
  telegramUserId: TelegramUserId | null;
  displayName?: string | null;
};

export type StaffIdentity = {
  staffId: StaffId;
  employment: string;
  displayName: string | null;
  slackUserId: string | null;
  telegramUserId: string | null;
};

export async function linkStaff(db: Db, input: StaffLink): Promise<void> {
  const displayName = input.displayName?.trim() ? input.displayName.trim() : null;
  await db.query(
    `insert into staff_identities (staff_id, employment, slack_user_id, telegram_user_id, display_name)
     values ($1, $2, $3, $4, $5)
     on conflict (staff_id) do update set
       employment = excluded.employment,
       slack_user_id = excluded.slack_user_id,
       telegram_user_id = excluded.telegram_user_id,
       display_name = coalesce(excluded.display_name, staff_identities.display_name),
       updated_at = now()`,
    [input.staffId, input.employment, input.slackUserId, input.telegramUserId, displayName],
  );
}

function mapStaffRow(row: {
  staff_id: string;
  employment: string;
  display_name: string | null;
  slack_user_id: string | null;
  telegram_user_id: string | null;
}): StaffIdentity {
  const staffId = parseStaffId(row.staff_id);
  if (staffId === null) throw new Error("staff_id in the database is not a uuid");
  return {
    staffId,
    employment: row.employment,
    displayName: row.display_name,
    slackUserId: row.slack_user_id,
    telegramUserId: row.telegram_user_id,
  };
}

export async function findStaffBySurface(
  db: Db,
  surface: Surface,
  externalUserId: string,
): Promise<StaffIdentity | null> {
  const column = SURFACE_USER_COLUMN[surface];
  const rows = await db.query<{
    staff_id: string;
    employment: string;
    display_name: string | null;
    slack_user_id: string | null;
    telegram_user_id: string | null;
  }>(
    `select staff_id, employment, display_name, slack_user_id, telegram_user_id
     from staff_identities where ${column} = $1`,
    [externalUserId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return mapStaffRow(row);
}

export async function findStaffById(db: Db, staffId: StaffId): Promise<StaffIdentity | null> {
  const rows = await db.query<{
    staff_id: string;
    employment: string;
    display_name: string | null;
    slack_user_id: string | null;
    telegram_user_id: string | null;
  }>(
    `select staff_id, employment, display_name, slack_user_id, telegram_user_id
     from staff_identities where staff_id = $1`,
    [staffId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return mapStaffRow(row);
}

function labelFor(identity: StaffIdentity | null, staffId: StaffId): string {
  if (identity === null) return formatStaffLabel({ staffId });
  return formatStaffLabel({
    staffId: identity.staffId,
    displayName: identity.displayName,
    slackUserId: identity.slackUserId,
  });
}

async function staffExists(query: Query, staffId: StaffId): Promise<boolean> {
  const rows = await query(`select staff_id from staff_identities where staff_id = $1`, [staffId]);
  return rows.length > 0;
}

async function ensureChannel(query: Query, grant: ChannelGrant): Promise<void> {
  await query(
    `insert into channel_allowlist (surface, channel_id, name)
     values ($1, $2, $3)
     on conflict (surface, channel_id) do update set name = excluded.name`,
    [grant.surface, grant.channelId, grant.name],
  );
}

function asTaskStatus(raw: string): TaskStatus {
  if ((TASK_STATUSES as readonly string[]).includes(raw)) {
    return raw as TaskStatus;
  }
  throw new Error(`bad task status ${raw}`);
}

export type OpenedTask = {
  taskId: string;
  eventId: string;
  outboxId: string;
  title: string;
  status: TaskStatus;
  created: boolean;
};

export async function openTask(
  db: Db,
  input: {
    grants: readonly ChannelGrant[];
    templateKey: TaskTemplateKey;
    staffId: StaffId;
    surface: Surface;
    channelId: ChannelId;
    idempotencyKey: string;
  },
): Promise<Result<OpenedTask>> {
  const grant = findGrant(input.grants, input.surface, input.channelId);
  if (grant === null) return { ok: false, reason: "channel_not_allowlisted" };
  const opener = await findStaffById(db, input.staffId);
  if (opener === null) return { ok: false, reason: "unknown_staff" };
  const staffLabel = labelFor(opener, input.staffId);
  const template = TASK_TEMPLATES[input.templateKey];

  return db.transaction(async (query) => {
    await ensureChannel(query, grant);
    const inserted = await query<{ id: string }>(
      `insert into events (event_type, surface, actor_staff_id, idempotency_key, payload)
       values ('task.opened', $1, $2, $3, $4::jsonb)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        input.surface,
        input.staffId,
        input.idempotencyKey,
        JSON.stringify({ templateKey: input.templateKey, channelId: input.channelId }),
      ],
    );
    const freshId = inserted[0]?.id;
    if (freshId === undefined) {
      const existing = await query<{
        taskId: string;
        title: string;
        status: string;
        eventId: string;
        outboxId: string;
      }>(
        `select t.id as "taskId", t.title, t.status, e.id as "eventId", o.id as "outboxId"
         from events e
         join tasks t on t.opened_event_id = e.id
         join outbox o on o.event_id = e.id
           and o.destination = e.surface
           and o.card_template = 'draft_for_approve'
         where e.idempotency_key = $1`,
        [input.idempotencyKey],
      );
      const row = existing[0];
      if (row === undefined) throw new Error("task.opened event has no task");
      return {
        ok: true,
        value: { ...row, status: asTaskStatus(row.status), created: false },
      };
    }

    const tasks = await query<{ id: string }>(
      `insert into tasks (
         template_key, title, channel_surface, channel_id, opener_staff_id, opened_event_id
       ) values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [input.templateKey, template.title, input.surface, input.channelId, input.staffId, freshId],
    );
    const taskId = tasks[0]?.id;
    if (taskId === undefined) throw new Error("task insert returned no id");
    const card = draftForApproveCard({
      title: template.title,
      templateKey: input.templateKey,
      taskId,
      staffLabel,
    });
    const outbox = await query<{ id: string }>(
      `insert into outbox (event_id, destination, card_template, payload)
       values ($1, $2, 'draft_for_approve', $3::jsonb)
       returning id`,
      [
        freshId,
        input.surface,
        JSON.stringify({
          channelId: input.channelId,
          taskId,
          text: card.text,
          blocks: card.blocks,
        }),
      ],
    );
    const outboxId = outbox[0]?.id;
    if (outboxId === undefined) throw new Error("outbox insert returned no id");
    return {
      ok: true,
      value: {
        taskId,
        eventId: freshId,
        outboxId,
        title: template.title,
        status: "open",
        created: true,
      },
    };
  });
}


export async function openFranbirdTell(
  db: Db,
  input: {
    grants: readonly ChannelGrant[];
    openerStaffId: StaffId;
    assigneeStaffId: StaffId;
    assigneeSlackUserId: SlackUserId;
    surface: Surface;
    channelId: ChannelId;
    body: string;
    briefing: BriefingMode;
    idempotencyKey: string;
  },
): Promise<Result<OpenedTask & { ackOutboxId: string; dmOutboxId: string }>> {
  const grant = findGrant(input.grants, input.surface, input.channelId);
  if (grant === null) return { ok: false, reason: "channel_not_allowlisted" };
  const opener = await findStaffById(db, input.openerStaffId);
  if (opener === null) return { ok: false, reason: "unknown_staff" };
  const assignee = await findStaffById(db, input.assigneeStaffId);
  if (assignee === null) return { ok: false, reason: "unknown_assignee" };
  const openerLabel = labelFor(opener, input.openerStaffId);
  const assigneeLabel = labelFor(assignee, input.assigneeStaffId);
  const briefingRequired = input.briefing === "required";
  const title = TASK_TEMPLATES.tell.title;

  return db.transaction(async (query) => {
    await ensureChannel(query, grant);
    const inserted = await query<{ id: string }>(
      `insert into events (event_type, surface, actor_staff_id, idempotency_key, payload)
       values ('task.opened', $1, $2, $3, $4::jsonb)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        input.surface,
        input.openerStaffId,
        input.idempotencyKey,
        JSON.stringify({
          templateKey: "tell",
          channelId: input.channelId,
          assigneeStaffId: input.assigneeStaffId,
          briefing: input.briefing,
          body: input.body,
        }),
      ],
    );
    const freshId = inserted[0]?.id;
    if (freshId === undefined) {
      const existing = await query<{
        taskId: string;
        title: string;
        status: string;
        eventId: string;
        outboxId: string;
        ackOutboxId: string;
        dmOutboxId: string;
      }>(
        `select t.id as "taskId", t.title, t.status, e.id as "eventId",
                o.id as "outboxId", a.id as "ackOutboxId", d.id as "dmOutboxId"
         from events e
         join tasks t on t.opened_event_id = e.id
         join outbox o on o.event_id = e.id and o.card_template = 'draft_for_approve'
         join outbox a on a.event_id = e.id and a.card_template = 'ack'
         join outbox d on d.event_id = e.id and d.card_template = 'dm_ack'
         where e.idempotency_key = $1`,
        [input.idempotencyKey],
      );
      const row = existing[0];
      if (row === undefined) throw new Error("franbird tell event has no task");
      return {
        ok: true,
        value: {
          taskId: row.taskId,
          eventId: row.eventId,
          outboxId: row.outboxId,
          ackOutboxId: row.ackOutboxId,
          dmOutboxId: row.dmOutboxId,
          title: row.title,
          status: asTaskStatus(row.status),
          created: false,
        },
      };
    }

    const tasks = await query<{ id: string }>(
      `insert into tasks (
         template_key, title, channel_surface, channel_id,
         opener_staff_id, assignee_staff_id, briefing_required, opened_event_id
       ) values ('tell', $1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        title,
        input.surface,
        input.channelId,
        input.openerStaffId,
        input.assigneeStaffId,
        briefingRequired,
        freshId,
      ],
    );
    const taskId = tasks[0]?.id;
    if (taskId === undefined) throw new Error("tell task insert returned no id");

    const card = franbirdTellCard({
      taskId,
      body: input.body,
      openerLabel,
      assigneeLabel,
      briefing: input.briefing,
    });
    const outbox = await query<{ id: string }>(
      `insert into outbox (event_id, destination, card_template, payload)
       values ($1, 'slack', 'draft_for_approve', $2::jsonb)
       returning id`,
      [
        freshId,
        JSON.stringify({
          channelId: input.channelId,
          taskId,
          text: card.text,
          blocks: card.blocks,
          bindMessageRef: true,
        }),
      ],
    );
    const outboxId = outbox[0]?.id;
    if (outboxId === undefined) throw new Error("tell outbox insert returned no id");

    const channelAck = ackCard({
      taskId,
      text: `Logged tell for <@${input.assigneeSlackUserId}> (briefing ${input.briefing}).`,
    });
    const ack = await query<{ id: string }>(
      `insert into outbox (event_id, destination, card_template, payload)
              values ($1, 'slack', 'ack', $2::jsonb)
       returning id`,
      [
        freshId,
        JSON.stringify({
          kind: "channel_ack",
          channelId: input.channelId,
          taskId,
          text: channelAck.text,
          blocks: channelAck.blocks,
          bindMessageRef: false,
        }),
      ],
    );
    const ackOutboxId = ack[0]?.id;
    if (ackOutboxId === undefined) throw new Error("channel ack outbox insert returned no id");

    const dmAck = ackCard({
      taskId,
      text: `Franbird tell from ${openerLabel}: ${input.body} (briefing ${input.briefing})`,
    });
    const dm = await query<{ id: string }>(
      `insert into outbox (event_id, destination, card_template, payload)
              values ($1, 'slack', 'dm_ack', $2::jsonb)
       returning id`,
      [
        freshId,
        JSON.stringify({
          kind: "dm_ack",
          channelId: input.assigneeSlackUserId,
          taskId,
          text: dmAck.text,
          blocks: dmAck.blocks,
          bindMessageRef: false,
        }),
      ],
    );
    const dmOutboxId = dm[0]?.id;
    if (dmOutboxId === undefined) throw new Error("dm ack outbox insert returned no id");

    return {
      ok: true,
      value: {
        taskId,
        eventId: freshId,
        outboxId,
        ackOutboxId,
        dmOutboxId,
        title,
        status: "open",
        created: true,
      },
    };
  });
}
export async function ingestChannelMessage(
  db: Db,
  input: {
    grants: readonly ChannelGrant[];
    surface: Surface;
    channelId: ChannelId;
    actorStaffId: StaffId | null;
    text: string;
    idempotencyKey: string;
  },
): Promise<Result<{ eventId: string }>> {
  const grant = findGrant(input.grants, input.surface, input.channelId);
  if (grant === null) return { ok: false, reason: "channel_not_allowlisted" };
  return db.transaction(async (query) => {
    await ensureChannel(query, grant);
    const inserted = await query<{ id: string }>(
      `insert into events (event_type, surface, actor_staff_id, idempotency_key, payload)
       values ('channel.message', $1, $2, $3, $4::jsonb)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        input.surface,
        input.actorStaffId,
        input.idempotencyKey,
        JSON.stringify({ text: input.text, channelId: input.channelId }),
      ],
    );
    const freshId = inserted[0]?.id;
    if (freshId !== undefined) return { ok: true, value: { eventId: freshId } };
    const existing = await query<{ id: string }>(
      `select id from events where idempotency_key = $1`,
      [input.idempotencyKey],
    );
    const eventId = existing[0]?.id;
    if (eventId === undefined) throw new Error("missing channel.message");
    return { ok: true, value: { eventId } };
  });
}

export async function applyStamp(
  db: Db,
  input: {
    grants: readonly ChannelGrant[];
    surface: Surface;
    channelId: ChannelId;
    messageRef: string;
    kind: StampKind;
    staffId: StaffId;
    externalRef: string;
  },
): Promise<Result<{ stampId: string; taskId: string; status: TaskStatus; created: boolean }>> {
  const grant = findGrant(input.grants, input.surface, input.channelId);
  if (grant === null) return { ok: false, reason: "channel_not_allowlisted" };
  if (!(await staffExists(db.query, input.staffId))) return { ok: false, reason: "unknown_staff" };
  const nextStatus = STAMP_TO_STATUS[input.kind];

  return db.transaction(async (query) => {
    const tasks = await query<{ id: string }>(
      `select id from tasks
       where channel_surface = $1 and channel_id = $2 and message_ref = $3`,
      [input.surface, input.channelId, input.messageRef],
    );
    const taskId = tasks[0]?.id;
    if (taskId === undefined) return { ok: false, reason: "no_task" };

    const eventInserted = await query<{ id: string }>(
      `insert into events (event_type, surface, actor_staff_id, idempotency_key, payload)
       values ('stamp.applied', $1, $2, $3, $4::jsonb)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        input.surface,
        input.staffId,
        input.externalRef,
        JSON.stringify({ kind: input.kind, taskId }),
      ],
    );
    const eventId = eventInserted[0]?.id;
    if (eventId === undefined) {
      const existing = await query<{ stamp_id: string; task_id: string; status: string }>(
        `select s.id as stamp_id, s.task_id, t.status
         from stamps s
         join tasks t on t.id = s.task_id
         where s.surface = $1 and s.external_ref = $2`,
        [input.surface, input.externalRef],
      );
      const row = existing[0];
      if (row === undefined) throw new Error("stamp event has no stamp");
      return {
        ok: true,
        value: {
          stampId: row.stamp_id,
          taskId: row.task_id,
          status: asTaskStatus(row.status),
          created: false,
        },
      };
    }

    const stamps = await query<{ id: string }>(
      `insert into stamps (task_id, kind, staff_id, surface, external_ref, event_id)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [taskId, input.kind, input.staffId, input.surface, input.externalRef, eventId],
    );
    const stampId = stamps[0]?.id;
    if (stampId === undefined) throw new Error("stamp insert returned no id");
    await query(`update tasks set status = $2, updated_at = now() where id = $1`, [taskId, nextStatus]);
    return { ok: true, value: { stampId, taskId, status: nextStatus, created: true } };
  });
}

export async function recordCardDecision(
  db: Db,
  input: {
    decision: "approve" | "send_back";
    taskId: TaskId;
    staffId: StaffId;
    surface: Surface;
    idempotencyKey: string;
  },
): Promise<Result<{ eventId: string; eventType: EventType; created: boolean }>> {
  if (!(await staffExists(db.query, input.staffId))) return { ok: false, reason: "unknown_staff" };
  const eventType: EventType = input.decision === "approve" ? "card.approved" : "card.sent_back";

  return db.transaction(async (query) => {
    const tasks = await query(`select id from tasks where id = $1`, [input.taskId]);
    if (tasks.length === 0) return { ok: false, reason: "unknown_task" };
    const inserted = await query<{ id: string }>(
      `insert into events (event_type, surface, actor_staff_id, idempotency_key, payload)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        eventType,
        input.surface,
        input.staffId,
        input.idempotencyKey,
        JSON.stringify({ taskId: input.taskId, decision: input.decision }),
      ],
    );
    const freshId = inserted[0]?.id;
    if (freshId !== undefined) {
      const nextStatus = input.decision === "approve" ? "done" : "blocked";
      await query(`update tasks set status = $2, updated_at = now() where id = $1`, [
        input.taskId,
        nextStatus,
      ]);
      return { ok: true, value: { eventId: freshId, eventType, created: true } };
    }
    const existing = await query<{ id: string; event_type: string }>(
      `select id, event_type from events where idempotency_key = $1`,
      [input.idempotencyKey],
    );
    const row = existing[0];
    if (row === undefined) throw new Error("missing card decision");
    if (row.event_type !== eventType) throw new Error("card decision idempotency key changed type");
    return { ok: true, value: { eventId: row.id, eventType, created: false } };
  });
}
