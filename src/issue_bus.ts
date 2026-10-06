import { findGrant, IT_HELPDESK_CHANNEL_ID, type ChannelGrant } from "./allowlist.ts";
import { findStaffById } from "./bus.ts";
import { issueApproveCard } from "./cards.ts";
import type { Db, Query } from "./db.ts";
import { formatStaffLabel, parseStaffId, type ChannelId, type StaffId } from "./domain.ts";
import {
  ISSUE_PLAYBOOK,
  hardwareCarePlusDraft,
  isIssueStatus,
  nextIssueStatus,
  normalizePhotoRef,
  parseHardwareCaption,
  parseIssueId,
  readHardwarePayload,
  type EvidenceRef,
  type HardwarePayload,
  type IssueAction,
  type IssueId,
  type IssueResult,
  type IssueStatus,
  type PhotoRef,
} from "./issue_domain.ts";

export type RaisedIssue = {
  issueId: IssueId;
  status: IssueStatus;
  created: boolean;
};

export type DecidedIssue = {
  issueId: IssueId;
  status: IssueStatus;
  created: boolean;
};

function requireStatus(raw: string): IssueStatus {
  if (!isIssueStatus(raw)) throw new Error(`bad issue status ${raw}`);
  return raw;
}

async function ensureChannel(query: Query, grant: ChannelGrant): Promise<void> {
  await query(
    `insert into channel_allowlist (surface, channel_id, name)
     values ($1, $2, $3)
     on conflict (surface, channel_id) do update set name = excluded.name`,
    [grant.surface, grant.channelId, grant.name],
  );
}

function sameStaff(rowId: string, staffId: StaffId): boolean {
  return parseStaffId(rowId) === staffId;
}

export async function raiseHardwareIssue(
  db: Db,
  input: {
    grants: readonly ChannelGrant[];
    channelId: ChannelId;
    raiserStaffId: StaffId;
    approverStaffId: StaffId;
    threadTs: string;
    caption: string;
    photos: { slackFileId: string; url: string | null }[];
    idempotencyKey: string;
  },
): Promise<IssueResult<RaisedIssue>> {
  if (input.threadTs.trim() === "" || input.idempotencyKey.trim() === "") {
    return { ok: false, reason: "bad_payload" };
  }
  if (input.channelId !== IT_HELPDESK_CHANNEL_ID) return { ok: false, reason: "not_helpdesk" };
  const grant = findGrant(input.grants, "slack", input.channelId);
  if (grant === null) return { ok: false, reason: "channel_not_allowlisted" };
  const photoRefs: PhotoRef[] = [];
  for (const photo of input.photos) {
    const normalized = normalizePhotoRef(photo);
    if (normalized !== null) photoRefs.push(normalized);
  }
  if (photoRefs.length === 0) return { ok: false, reason: "no_photo" };
  const raiser = await findStaffById(db, input.raiserStaffId);
  if (raiser === null) return { ok: false, reason: "unknown_staff" };
  const approver = await findStaffById(db, input.approverStaffId);
  if (approver === null) return { ok: false, reason: "approver_unconfigured" };

  const parsed = parseHardwareCaption(input.caption);
  const payload: HardwarePayload = { ...parsed, photoRefs };
  const evidence: EvidenceRef[] = [
    ...photoRefs.map((photo) => ({ kind: "slack_file" as const, ...photo })),
    { kind: "slack_thread", channelId: input.channelId, threadTs: input.threadTs },
  ];

  return db.transaction(async (query) => {
    await ensureChannel(query, grant);
    const inserted = await query<{ id: string }>(
      `insert into events (event_type, surface, actor_staff_id, idempotency_key, payload)
       values ('issue.raised', 'slack', $1, $2, $3::jsonb)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        input.raiserStaffId,
        input.idempotencyKey,
        JSON.stringify({ playbook: ISSUE_PLAYBOOK, channelId: input.channelId }),
      ],
    );
    const eventId = inserted[0]?.id;
    if (eventId === undefined) {
      const existing = await query<{ id: string; status: string }>(
        `select i.id, i.status
         from events e
         join issues i on i.raise_event_id = e.id
         where e.idempotency_key = $1`,
        [input.idempotencyKey],
      );
      const row = existing[0];
      if (row === undefined) throw new Error("issue.raised event has no issue");
      const issueId = parseIssueId(row.id);
      if (issueId === null) throw new Error("issue id in the database is not a uuid");
      return { ok: true, value: { issueId, status: requireStatus(row.status), created: false } };
    }

    const issues = await query<{ id: string }>(
      `insert into issues (
         playbook, status, raiser_staff_id, approver_staff_id,
         payload, evidence, surface, channel_id, thread_ts,
         raise_event_id, idempotency_key
       ) values (
         $1, 'waiting_approve', $2, $3,
         $4::jsonb, $5::jsonb, 'slack', $6, $7,
         $8, $9
       )
       returning id`,
      [
        ISSUE_PLAYBOOK,
        input.raiserStaffId,
        input.approverStaffId,
        JSON.stringify(payload),
        JSON.stringify(evidence),
        input.channelId,
        input.threadTs,
        eventId,
        input.idempotencyKey,
      ],
    );
    const rawId = issues[0]?.id;
    if (rawId === undefined) throw new Error("issue insert returned no id");
    const issueId = parseIssueId(rawId);
    if (issueId === null) throw new Error("issue id in the database is not a uuid");
    const card = issueApproveCard({
      issueId,
      raiserLabel: formatStaffLabel({
        staffId: raiser.staffId,
        displayName: raiser.displayName,
        slackUserId: raiser.slackUserId,
      }),
      payload,
    });
    await query(
      `insert into outbox (event_id, destination, card_template, payload)
       values ($1, 'slack', 'issue_approve', $2::jsonb)`,
      [
        eventId,
        JSON.stringify({
          channelId: input.channelId,
          taskId: issueId,
          text: card.text,
          blocks: card.blocks,
          bindMessageRef: false,
          threadTs: input.threadTs,
        }),
      ],
    );
    return { ok: true, value: { issueId, status: "waiting_approve", created: true } };
  });
}

export async function decideHardwareIssue(
  db: Db,
  input: {
    issueId: string;
    action: IssueAction;
    actorStaffId: StaffId;
    idempotencyKey: string;
  },
): Promise<IssueResult<DecidedIssue>> {
  const issueId = parseIssueId(input.issueId);
  if (issueId === null || input.idempotencyKey.trim() === "") {
    return { ok: false, reason: "bad_payload" };
  }
  const actor = await findStaffById(db, input.actorStaffId);
  if (actor === null) return { ok: false, reason: "unknown_staff" };

  return db.transaction(async (query) => {
    const rows = await query<{
      id: string;
      status: string;
      approver_staff_id: string;
      payload: unknown;
    }>(
      `select id, status, approver_staff_id, payload
       from issues
       where id = $1
       for update`,
      [issueId],
    );
    const row = rows[0];
    if (row === undefined) return { ok: false, reason: "unknown_issue" };
    if (!sameStaff(row.approver_staff_id, input.actorStaffId)) {
      return { ok: false, reason: "not_approver" };
    }
    const status = requireStatus(row.status);
    const existing = await query<{ id: string }>(
      `select id from events where idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing.length > 0) {
      return { ok: true, value: { issueId, status, created: false } };
    }
    const next = nextIssueStatus(status, input.action);
    if (next === null) return { ok: false, reason: "bad_status" };

    let evidenceEntry: EvidenceRef;
    if (input.action === "approve") {
      const payload = readHardwarePayload(row.payload);
      if (payload === null) return { ok: false, reason: "bad_payload" };
      const draft = hardwareCarePlusDraft({ issueId, payload });
      evidenceEntry = {
        kind: "email_draft",
        template: "samsung_care_plus",
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        delivery: "outbox_ready",
      };
    } else {
      evidenceEntry = { kind: "note", text: "send back", staffId: input.actorStaffId };
    }

    const eventType = input.action === "approve" ? "issue.approved" : "issue.sent_back";
    const inserted = await query<{ id: string }>(
      `insert into events (event_type, surface, actor_staff_id, idempotency_key, payload)
       values ($1, 'slack', $2, $3, $4::jsonb)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        eventType,
        input.actorStaffId,
        input.idempotencyKey,
        JSON.stringify({ issueId, action: input.action }),
      ],
    );
    if (inserted[0] === undefined) {
      return { ok: true, value: { issueId, status, created: false } };
    }
    const updated = await query<{ id: string }>(
      `update issues
       set status = $2,
           evidence = evidence || $3::jsonb,
           updated_at = now()
       where id = $1 and status = $4
       returning id`,
      [issueId, next, JSON.stringify([evidenceEntry]), status],
    );
    if (updated[0] === undefined) throw new Error("issue status changed during decision");
    return { ok: true, value: { issueId, status: next, created: true } };
  });
}
