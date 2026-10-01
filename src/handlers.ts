import { findGrant, type ChannelGrant } from "./allowlist.ts";
import { applyStamp, findStaffBySurface, ingestChannelMessage, openFranbirdTell, openTask, recordCardDecision } from "./bus.ts";
import type { Db } from "./db.ts";
import {
  birdCommandHelp,
  parseFranbirdTell,
  parseFranText,
  parseSlackChannelId,
  parseSlackUserId,
  parseStaffId,
  parseTaskId,
  stampForReaction,
  TASK_TEMPLATE_KEYS,
  type BusReason,
  type StaffId,
} from "./domain.ts";

function replyFor(reason: BusReason): string {
  switch (reason) {
    case "unknown_template":
      return `Use a template: ${TASK_TEMPLATE_KEYS.join(", ")}.`;
    case "free_text":
      return "Templates do not take free text.";
    case "channel_not_allowlisted":
      return "This channel is not allowlisted.";
    case "unknown_staff":
      return "Your Slack user is not linked to a staff record.";
    case "bad_payload":
      return "Could not read that command.";
    case "no_task":
      return "That message is not a task card.";
    case "unknown_task":
      return "That task does not exist.";
    case "unknown_assignee":
      return "That person is not linked in staff_identities.";
    case "bad_franbird":
      return "Use: tell <@user> <message> [briefing=optional|required] (also: please/ask/to, /bird tell …)";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function requireStaffId(raw: string): StaffId {
  const staffId = parseStaffId(raw);
  if (staffId === null) throw new Error("staff_id in the database is not a uuid");
  return staffId;
}

export async function handleFranCommand(
  db: Db,
  grants: readonly ChannelGrant[],
  input: { text: string; slackUserId: string; channelId: string; triggerId: string },
): Promise<{ reply: string }> {
  const trimmed = input.text.trim();
  if (trimmed.length === 0 || /^(help|\?|commands)$/i.test(trimmed)) {
    return { reply: birdCommandHelp() };
  }
  const channelId = parseSlackChannelId(input.channelId);
  const slackUserId = parseSlackUserId(input.slackUserId);
  if (channelId === null || slackUserId === null || input.triggerId.trim() === "") {
    return { reply: replyFor("bad_payload") };
  }
  if (findGrant(grants, "slack", channelId) === null) {
    return { reply: replyFor("channel_not_allowlisted") };
  }
  const staff = await findStaffBySurface(db, "slack", slackUserId);
  if (staff === null) return { reply: replyFor("unknown_staff") };

  const tell = parseFranbirdTell(trimmed);
  if (tell.ok) {
    const assignee = await findStaffBySurface(db, "slack", tell.value.assigneeSlackUserId);
    if (assignee === null) return { reply: replyFor("unknown_assignee") };
    const openedTell = await openFranbirdTell(db, {
      grants,
      openerStaffId: requireStaffId(staff.staffId),
      assigneeStaffId: requireStaffId(assignee.staffId),
      assigneeSlackUserId: tell.value.assigneeSlackUserId,
      surface: "slack",
      channelId,
      body: tell.value.body,
      briefing: tell.value.briefing,
      idempotencyKey: `slack:command:${input.triggerId}`,
    });
    if (!openedTell.ok) return { reply: replyFor(openedTell.reason) };
    return {
      reply: `Logged ${openedTell.value.title}. Briefing ${tell.value.briefing}.`,
    };
  }

  const parsed = parseFranText(trimmed);
  if (!parsed.ok) {
    return {
      reply: `${replyFor(parsed.reason)}\n\n${birdCommandHelp()}`,
    };
  }
  const opened = await openTask(db, {
    grants,
    templateKey: parsed.value.templateKey,
    staffId: requireStaffId(staff.staffId),
    surface: "slack",
    channelId,
    idempotencyKey: `slack:command:${input.triggerId}`,
  });
  if (!opened.ok) return { reply: replyFor(opened.reason) };
  return { reply: `Opened ${opened.value.title}.` };
}

export async function handleChannelMessage(
  db: Db,
  grants: readonly ChannelGrant[],
  input: {
    eventId: string;
    channelId: string;
    slackUserId: string | null;
    text: string;
    bot: boolean;
  },
): Promise<{ stored: boolean }> {
  if (input.bot || input.eventId.trim() === "") return { stored: false };
  const channelId = parseSlackChannelId(input.channelId);
  if (channelId === null) return { stored: false };
  if (findGrant(grants, "slack", channelId) === null) return { stored: false };
  let actorStaffId: StaffId | null = null;
  if (input.slackUserId !== null) {
    const slackUserId = parseSlackUserId(input.slackUserId);
    if (slackUserId !== null) {
      const staff = await findStaffBySurface(db, "slack", slackUserId);
      if (staff !== null) actorStaffId = requireStaffId(staff.staffId);
    }
  }
  const stored = await ingestChannelMessage(db, {
    grants,
    surface: "slack",
    channelId,
    actorStaffId,
    text: input.text,
    idempotencyKey: `slack:event:${input.eventId}`,
  });
  return { stored: stored.ok };
}

export async function handleReaction(
  db: Db,
  grants: readonly ChannelGrant[],
  input: { slackUserId: string; emoji: string; channelId: string; messageRef: string },
): Promise<{ applied: boolean }> {
  const kind = stampForReaction(input.emoji);
  if (kind === null) return { applied: false };
  const channelId = parseSlackChannelId(input.channelId);
  const slackUserId = parseSlackUserId(input.slackUserId);
  if (channelId === null || slackUserId === null || input.messageRef.trim() === "") return { applied: false };
  const staff = await findStaffBySurface(db, "slack", slackUserId);
  if (staff === null) return { applied: false };
  const result = await applyStamp(db, {
    grants,
    surface: "slack",
    channelId,
    messageRef: input.messageRef,
    kind,
    staffId: requireStaffId(staff.staffId),
    externalRef: `slack:reaction:${slackUserId}:${input.emoji}:${channelId}:${input.messageRef}`,
  });
  return { applied: result.ok };
}

export async function handleCardAction(
  db: Db,
  input: { actionId: string; taskId: string; slackUserId: string; actionTs: string },
): Promise<{ recorded: boolean }> {
  const decision = input.actionId === "card.approve"
    ? "approve"
    : input.actionId === "card.send_back"
      ? "send_back"
      : null;
  if (decision === null) return { recorded: false };
  const taskId = parseTaskId(input.taskId);
  const slackUserId = parseSlackUserId(input.slackUserId);
  if (taskId === null || slackUserId === null || input.actionTs.trim() === "") return { recorded: false };
  const staff = await findStaffBySurface(db, "slack", slackUserId);
  if (staff === null) return { recorded: false };
  const result = await recordCardDecision(db, {
    decision,
    taskId,
    staffId: requireStaffId(staff.staffId),
    surface: "slack",
    idempotencyKey: `slack:action:${slackUserId}:${input.actionId}:${taskId}:${input.actionTs}`,
  });
  return { recorded: result.ok };
}

export async function handleAppMention(
  db: Db,
  grants: readonly ChannelGrant[],
  input: {
    eventId: string;
    channelId: string;
    slackUserId: string;
    text: string;
  },
): Promise<{ ok: boolean; reply: string; taskId?: string }> {
  const channelId = parseSlackChannelId(input.channelId);
  const slackUserId = parseSlackUserId(input.slackUserId);
  if (channelId === null || slackUserId === null || input.eventId.trim() === "") {
    return { ok: false, reply: replyFor("bad_payload") };
  }
  if (findGrant(grants, "slack", channelId) === null) {
    return { ok: false, reply: replyFor("channel_not_allowlisted") };
  }
  const parsed = parseFranbirdTell(input.text);
  if (!parsed.ok) return { ok: false, reply: replyFor(parsed.reason) };
  const opener = await findStaffBySurface(db, "slack", slackUserId);
  if (opener === null) return { ok: false, reply: replyFor("unknown_staff") };
  const assignee = await findStaffBySurface(db, "slack", parsed.value.assigneeSlackUserId);
  if (assignee === null) return { ok: false, reply: replyFor("unknown_assignee") };
  const opened = await openFranbirdTell(db, {
    grants,
    openerStaffId: requireStaffId(opener.staffId),
    assigneeStaffId: requireStaffId(assignee.staffId),
    assigneeSlackUserId: parsed.value.assigneeSlackUserId,
    surface: "slack",
    channelId,
    body: parsed.value.body,
    briefing: parsed.value.briefing,
    idempotencyKey: `slack:app_mention:${input.eventId}`,
  });
  if (!opened.ok) return { ok: false, reply: replyFor(opened.reason) };
  return {
    ok: true,
    reply: `Logged ${opened.value.title}. Briefing ${parsed.value.briefing}.`,
    taskId: opened.value.taskId,
  };
}