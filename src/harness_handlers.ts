/**
 * Thin handlers shared by HTTP harness routes and MCP tool stubs.
 * Personal Grok bots call these; they are NOT a second SoT — fran-ops bus is.
 * Slack stays the human doorbell (issue raise enqueues approve card via outbox);
 * no bot↔bot Slack identity.
 */

import { IT_HELPDESK_CHANNEL_ID, type ChannelGrant } from "./allowlist.ts";
import {
  DEFAULT_ASSET_KIND,
  isAssetEventType,
  recordBotEvent,
  type AssetId,
} from "./asset_log.ts";
import { findStaffById, findStaffBySurface, listTaskInbox, type TaskInboxItem } from "./bus.ts";
import type { Db } from "./db.ts";
import { parseStaffId } from "./domain.ts";
import { raiseHardwareIssue, type RaisedIssue } from "./issue_bus.ts";
import { readIssueApproverSlackUserId } from "./issue_domain.ts";

export type HarnessIssueRaiseInput = {
  raiserStaffId: string;
  caption?: string;
  threadTs?: string;
  photos?: { slackFileId: string; url?: string | null }[];
  idempotencyKey: string;
  /**
   * When true (default), uses bus raiseHardwareIssue which enqueues Slack approve
   * card outbox (human-visible doorbell). false is reserved for a later dry path.
   */
  slackDoorbell?: boolean;
};

export type HarnessAssetAppendInput = {
  serial: string;
  eventType: string;
  kind?: string;
  site?: string | null;
  issueId?: string | null;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
};

export type HarnessTaskInboxInput = {
  staffId: string;
  includeDone?: boolean;
  limit?: number;
};

export type HarnessHandlerResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; reason?: string };

function bad(status: number, error: string, reason?: string): HarnessHandlerResult<never> {
  return reason === undefined ? { ok: false, status, error } : { ok: false, status, error, reason };
}

export async function harnessRaiseIssue(
  db: Db,
  grants: readonly ChannelGrant[],
  input: HarnessIssueRaiseInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HarnessHandlerResult<RaisedIssue & { doorbell: boolean }>> {
  const raiserStaffId = parseStaffId(input.raiserStaffId);
  if (raiserStaffId === null) return bad(400, "raiserStaffId must be a uuid", "bad_payload");
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length === 0) return bad(400, "idempotencyKey required", "bad_payload");

  const raiser = await findStaffById(db, raiserStaffId);
  if (raiser === null) return bad(404, "raiser staff not linked", "unknown_staff");

  const approverSlack = readIssueApproverSlackUserId(env);
  if (approverSlack === null) {
    return bad(503, "ISSUE_APPROVER_SLACK_USER_ID unset", "approver_unconfigured");
  }
  const approver = await findStaffBySurface(db, "slack", approverSlack);
  if (approver === null) {
    return bad(503, "approver Slack user not linked in staff_identities", "approver_unconfigured");
  }
  const approverStaffId = parseStaffId(approver.staffId);
  if (approverStaffId === null) return bad(500, "approver staff_id corrupt");

  const photos = (input.photos ?? []).map((p) => ({
    slackFileId: p.slackFileId,
    url: p.url ?? null,
  }));
  if (photos.length === 0) {
    return bad(400, "at least one photo slackFileId required", "no_photo");
  }

  const doorbell = input.slackDoorbell !== false;
  if (!doorbell) {
    return bad(501, "slackDoorbell=false dry path not implemented; omit or set true");
  }

  const threadTs = (input.threadTs ?? `harness:${idempotencyKey}`).trim();
  const raised = await raiseHardwareIssue(db, {
    grants,
    channelId: IT_HELPDESK_CHANNEL_ID,
    raiserStaffId,
    approverStaffId,
    threadTs,
    caption: input.caption ?? "",
    photos,
    idempotencyKey: `harness:issue:${idempotencyKey}`,
  });
  if (!raised.ok) {
    const status =
      raised.reason === "unknown_staff" || raised.reason === "approver_unconfigured"
        ? 404
        : raised.reason === "channel_not_allowlisted" || raised.reason === "not_helpdesk"
          ? 403
          : 400;
    return bad(status, raised.reason, raised.reason);
  }
  return { ok: true, value: { ...raised.value, doorbell: true } };
}

export async function harnessAppendAssetEvent(
  db: Db,
  input: HarnessAssetAppendInput,
): Promise<HarnessHandlerResult<{ assetId: AssetId; created: boolean; eventType: string }>> {
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length === 0) return bad(400, "idempotencyKey required", "bad_payload");
  if (!isAssetEventType(input.eventType)) {
    return bad(400, "eventType must be crack|claim_filed|oow|repair|swap|retire", "bad_payload");
  }
  const recorded = await recordBotEvent(db, {
    serial: input.serial,
    kind: input.kind?.trim() || DEFAULT_ASSET_KIND,
    site: input.site ?? null,
    eventType: input.eventType,
    issueId: input.issueId ?? null,
    idempotencyKey: `harness:asset:${idempotencyKey}`,
    payload: input.payload ?? {},
  });
  if (!recorded.ok) return bad(400, recorded.reason, recorded.reason);
  return {
    ok: true,
    value: {
      assetId: recorded.value.assetId,
      created: recorded.value.created,
      eventType: input.eventType,
    },
  };
}

export async function harnessTaskInbox(
  db: Db,
  input: HarnessTaskInboxInput,
): Promise<HarnessHandlerResult<{ staffId: string; tasks: TaskInboxItem[] }>> {
  const staffId = parseStaffId(input.staffId);
  if (staffId === null) return bad(400, "staffId must be a uuid", "bad_payload");
  const staff = await findStaffById(db, staffId);
  if (staff === null) return bad(404, "staff not linked", "unknown_staff");
  const tasks = await listTaskInbox(db, {
    staffId,
    includeDone: input.includeDone === true,
    limit: input.limit,
  });
  return { ok: true, value: { staffId, tasks } };
}
