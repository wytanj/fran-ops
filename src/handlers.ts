import { findGrant, type ChannelGrant } from "./allowlist.ts";
import { applyStamp, findStaffBySurface, ingestChannelMessage, openFranbirdTell, openTask, recordCardDecision } from "./bus.ts";
import type { Db } from "./db.ts";
import {
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
import {
  classifyStaffIntentAsync,
  formatRouteReply,
  runToolStubs,
  shouldSkipRouting,
} from "./routing.ts";
import { handleBillCommand, isBillText } from "./bill_handlers.ts";
import type { ThreadContext } from "./thread.ts";
import { threadTextsForRouting } from "./thread.ts";

function replyFor(reason: BusReason): string {
  switch (reason) {
    case "unknown_template":
      return `Use a template: ${TASK_TEMPLATE_KEYS.join(", ")}. Or ask about roster/docs/sku/pos (read stubs).`;
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

function helpText(): string {
  return [
    "Franbird commands:",
    `• Templates: ${TASK_TEMPLATE_KEYS.join(", ")}`,
    "• tell <@user> <message> [briefing=optional|required]",
    "• In a thread: @Franbird / /bird loads thread context (conversations.replies) and replies in-thread",
    "• Read stubs (staff-linked): roster | docs | sku/inventory | pos/sales — no auto writes",
    "• Bill-split: split <amount> [merchant] with <@user>… | tally | paid/settle <@user> <amount> | remind",
    "• Receipt image → extract → confirm card (no auto-commit)",
    "Writes stay approval-card only.",
  ].join("\n");
}

async function tryStaffRoute(text: string, thread: ThreadContext | null | undefined): Promise<string | null> {
  if (shouldSkipRouting(text)) return null;
  const decision = await classifyStaffIntentAsync({
    text,
    threadTexts: threadTextsForRouting(thread),
  });
  if (decision.intent === "unknown") return null;
  const stubs = runToolStubs(decision.tools);
  const reply = formatRouteReply(decision, stubs);
  return reply.length > 0 ? reply : null;
}

export async function handleFranCommand(
  db: Db,
  grants: readonly ChannelGrant[],
  input: {
    text: string;
    slackUserId: string;
    channelId: string;
    triggerId: string;
    thread?: ThreadContext | null;
  },
): Promise<{ reply: string; billCard?: import("./cards.ts").SlackCard; billThreadRef?: string | null }> {
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

  const trimmed = input.text.trim();
  if (trimmed === "" || /^help\b/i.test(trimmed)) {
    return { reply: helpText() };
  }
  if (/^whoami\b/i.test(trimmed)) {
    const label = staff.displayName?.trim() || staff.staffId.slice(0, 8);
    return {
      reply: `Linked as ${label} (${staff.employment}). Slack <@${slackUserId}>.`,
    };
  }

  if (isBillText(trimmed)) {
    const bill = await handleBillCommand(db, grants, {
      text: trimmed,
      slackUserId: input.slackUserId,
      channelId: input.channelId,
      triggerId: input.triggerId,
      threadRef: input.thread?.threadTs ?? null,
    });
    return { reply: bill.reply, billCard: bill.card, billThreadRef: bill.threadRef };
  }

  const tell = parseFranbirdTell(input.text);
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

  const routed = await tryStaffRoute(input.text, input.thread);
  if (routed !== null) return { reply: routed };

  const parsed = parseFranText(input.text);
  if (!parsed.ok) return { reply: replyFor(parsed.reason) };
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
    thread?: ThreadContext | null;
  },
): Promise<{ ok: boolean; reply: string; taskId?: string; billCard?: import("./cards.ts").SlackCard; billThreadRef?: string | null }> {
  const channelId = parseSlackChannelId(input.channelId);
  const slackUserId = parseSlackUserId(input.slackUserId);
  if (channelId === null || slackUserId === null || input.eventId.trim() === "") {
    return { ok: false, reply: replyFor("bad_payload") };
  }
  if (findGrant(grants, "slack", channelId) === null) {
    return { ok: false, reply: replyFor("channel_not_allowlisted") };
  }

  const stripped = input.text
    .replace(/^(?:\s*<@U[A-Z0-9]+(?:\|[^>]+)?>\s*)+/g, "")
    .replace(/^@?franbird\b[,:]?\s*/i, "")
    .trim();

  if (stripped === "" || /^help\b/i.test(stripped)) {
    return { ok: false, reply: helpText() };
  }

  const opener = await findStaffBySurface(db, "slack", slackUserId);
  if (opener === null) return { ok: false, reply: replyFor("unknown_staff") };

  if (/^whoami\b/i.test(stripped)) {
    const label = opener.displayName?.trim() || opener.staffId.slice(0, 8);
    return {
      ok: false,
      reply: `Linked as ${label} (${opener.employment}). Slack <@${slackUserId}>.`,
    };
  }

  if (isBillText(stripped)) {
    const bill = await handleBillCommand(db, grants, {
      text: stripped,
      slackUserId: input.slackUserId,
      channelId: input.channelId,
      triggerId: input.eventId,
      threadRef: input.thread?.threadTs ?? null,
    });
    return {
      ok: true,
      reply: bill.reply,
      billCard: bill.card,
      billThreadRef: bill.threadRef,
    };
  }

  const parsed = parseFranbirdTell(input.text);
  if (parsed.ok) {
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

  const routed = await tryStaffRoute(stripped, input.thread);
  if (routed !== null) return { ok: false, reply: routed };

  // Template via mention: "@Franbird shift_open"
  const asTemplate = parseFranText(stripped);
  if (asTemplate.ok) {
    const opened = await openTask(db, {
      grants,
      templateKey: asTemplate.value.templateKey,
      staffId: requireStaffId(opener.staffId),
      surface: "slack",
      channelId,
      idempotencyKey: `slack:app_mention:${input.eventId}`,
    });
    if (!opened.ok) return { ok: false, reply: replyFor(opened.reason) };
    return { ok: true, reply: `Opened ${opened.value.title}.`, taskId: opened.value.taskId };
  }

  return { ok: false, reply: replyFor(asTemplate.reason) };
}
