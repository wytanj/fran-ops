import { findGrant, IT_HELPDESK_CHANNEL_ID, type ChannelGrant } from "./allowlist.ts";
import { findStaffBySurface } from "./bus.ts";
import { issueResolvedCard, type SlackCard } from "./cards.ts";
import type { Db } from "./db.ts";
import { parseSlackChannelId, parseSlackUserId, type SlackUserId } from "./domain.ts";
import { decideHardwareIssue, raiseHardwareIssue } from "./issue_bus.ts";
import type { IssueAction, IssueReason } from "./issue_domain.ts";

export type HardwareSlackFile = {
  eventId: string;
  channelId: string;
  slackUserId: string;
  caption: string;
  threadTs: string;
  photos: { slackFileId: string; url: string | null }[];
};

export type HardwareFileResult = {
  raised: boolean;
  reason?: IssueReason;
  issueId?: string;
  created?: boolean;
};

function replyForIssue(reason: IssueReason): string {
  switch (reason) {
    case "not_approver":
      return "Only the hardware approver can decide this issue.";
    case "bad_status":
      return "That issue is not waiting for approval.";
    case "unknown_issue":
      return "That issue does not exist.";
    case "unknown_staff":
      return "Your Slack user is not linked to a staff record.";
    case "approver_unconfigured":
      return "The hardware approver is not configured.";
    case "channel_not_allowlisted":
      return "This channel is not allowlisted.";
    case "not_helpdesk":
      return "Hardware issues open only in #it-helpdesk.";
    case "no_photo":
      return "A hardware issue needs a photo.";
    case "bad_payload":
      return "Could not read that command.";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export async function handleHardwareChannelFile(
  db: Db,
  grants: readonly ChannelGrant[],
  input: HardwareSlackFile,
  approverSlackUserId: SlackUserId | null,
): Promise<HardwareFileResult> {
  const channelId = parseSlackChannelId(input.channelId);
  const slackUserId = parseSlackUserId(input.slackUserId);
  if (
    channelId === null ||
    slackUserId === null ||
    input.threadTs.trim() === "" ||
    input.eventId.trim() === ""
  ) {
    return { raised: false, reason: "bad_payload" };
  }
  if (channelId !== IT_HELPDESK_CHANNEL_ID) return { raised: false };
  if (findGrant(grants, "slack", channelId) === null) {
    return { raised: false, reason: "channel_not_allowlisted" };
  }
  if (approverSlackUserId === null) return { raised: false, reason: "approver_unconfigured" };
  const raiser = await findStaffBySurface(db, "slack", slackUserId);
  if (raiser === null) return { raised: false, reason: "unknown_staff" };
  const approver = await findStaffBySurface(db, "slack", approverSlackUserId);
  if (approver === null) return { raised: false, reason: "approver_unconfigured" };
  const raised = await raiseHardwareIssue(db, {
    grants,
    channelId,
    raiserStaffId: raiser.staffId,
    approverStaffId: approver.staffId,
    threadTs: input.threadTs,
    caption: input.caption,
    photos: input.photos,
    idempotencyKey: `slack:issue:${input.eventId}`,
  });
  if (!raised.ok) return { raised: false, reason: raised.reason };
  return { raised: true, issueId: raised.value.issueId, created: raised.value.created };
}

export async function handleIssueCardAction(
  db: Db,
  input: {
    actionId: string;
    issueId: string;
    slackUserId: string;
    actionTs: string;
  },
): Promise<{ recorded: boolean; reply?: string; card?: SlackCard }> {
  const action: IssueAction | null =
    input.actionId === "issue.approve"
      ? "approve"
      : input.actionId === "issue.send_back"
        ? "send_back"
        : null;
  if (action === null) return { recorded: false, reply: "Could not record that decision." };
  const slackUserId = parseSlackUserId(input.slackUserId);
  if (slackUserId === null || input.actionTs.trim() === "") {
    return { recorded: false, reply: "Could not read that command." };
  }
  const staff = await findStaffBySurface(db, "slack", slackUserId);
  if (staff === null) {
    return { recorded: false, reply: "Your Slack user is not linked to a staff record." };
  }
  const decided = await decideHardwareIssue(db, {
    issueId: input.issueId,
    action,
    actorStaffId: staff.staffId,
    idempotencyKey: `slack:issue:${input.actionId}:${input.issueId}:${input.actionTs}`,
  });
  if (!decided.ok) return { recorded: false, reply: replyForIssue(decided.reason) };
  return {
    recorded: true,
    card: issueResolvedCard({ issueId: decided.value.issueId, decision: action }),
  };
}
