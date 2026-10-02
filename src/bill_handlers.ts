/**
 * Bill-split command / freeform / receipt / card handlers.
 * Writes + ambiguous parses → confirm card; never auto-commit ambiguous.
 */

import { findGrant, type ChannelGrant } from "./allowlist.ts";
import {
  confirmExpense,
  formatTallyLines,
  labelStaff,
  loadChannelBalances,
  proposeExpense,
  recordSettlement,
  resolveSlackParticipants,
  voidExpense,
} from "./bill_bus.ts";
import { formatCents, parseExpenseId, type BillReason } from "./bill_domain.ts";
import {
  buildEqualShareRows,
  looksLikeBillCommand,
  parseBillExpense,
  parseBillRemind,
  parseBillSettle,
  parseBillTally,
} from "./bill_parse.ts";
import {
  expenseConfirmCard,
  resolvedBillCard,
  settleAckCard,
  tallyCard,
  type SlackCard,
} from "./cards.ts";
import { findStaffBySurface } from "./bus.ts";
import type { Db } from "./db.ts";
import {
  parseSlackChannelId,
  parseSlackUserId,
  parseStaffId,
  type StaffId,
} from "./domain.ts";
import { extractReceipt } from "./receipt.ts";
import { recordMediaIndex } from "./storage.ts";

function replyFor(reason: BillReason): string {
  switch (reason) {
    case "bad_bill":
      return "Use: split <amount> [merchant] with <@user>… | tally | settle/paid <@user> <amount> | remind [@user]";
    case "ambiguous_bill":
      return "Could not parse that expense cleanly — check amount and participants.";
    case "unknown_participant":
      return "A mentioned person is not linked in staff_identities.";
    case "share_mismatch":
      return "Shares do not sum to the expense amount.";
    case "unknown_expense":
      return "That expense does not exist.";
    case "expense_not_pending":
      return "That expense is not awaiting confirmation.";
    case "expense_not_confirmed":
      return "That expense is not confirmed.";
    case "channel_not_allowlisted":
      return "This channel is not allowlisted.";
    case "unknown_staff":
      return "Your Slack user is not linked to a staff record.";
    case "bad_payload":
      return "Could not read that command.";
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

export type BillHandlerReply = {
  reply: string;
  card?: SlackCard;
  /** When set, post card in thread (caller uses thread_ts). */
  threadRef?: string | null;
};

export function isBillText(text: string): boolean {
  return looksLikeBillCommand(text);
}

async function shareLinesFor(
  db: Db,
  shares: Array<{ staffId: StaffId; shareCents: number }>,
  currency: string,
): Promise<string> {
  const parts: string[] = [];
  for (const s of shares) {
    const label = await labelStaff(db, s.staffId);
    parts.push(`• ${label}: ${formatCents(s.shareCents, currency)}`);
  }
  return parts.join("\n");
}

export async function handleBillCommand(
  db: Db,
  grants: readonly ChannelGrant[],
  input: {
    text: string;
    slackUserId: string;
    channelId: string;
    triggerId: string;
    threadRef?: string | null;
  },
): Promise<BillHandlerReply> {
  const channelId = parseSlackChannelId(input.channelId);
  const slackUserId = parseSlackUserId(input.slackUserId);
  if (channelId === null || slackUserId === null || input.triggerId.trim() === "") {
    return { reply: replyFor("bad_payload") };
  }
  if (findGrant(grants, "slack", channelId) === null) {
    return { reply: replyFor("channel_not_allowlisted") };
  }
  const actor = await findStaffBySurface(db, "slack", slackUserId);
  if (actor === null) return { reply: replyFor("unknown_staff") };
  const actorStaffId = requireStaffId(actor.staffId);
  const trimmed = input.text.trim();

  if (parseBillTally(trimmed)) {
    return buildTallyReply(db, grants, {
      surface: "slack",
      channelId,
      channelLabel: findGrant(grants, "slack", channelId)?.name ?? channelId,
    });
  }

  const remind = parseBillRemind(trimmed);
  if (remind.ok) {
    return handleRemind(db, grants, {
      channelId,
      actorStaffId,
      counterpartySlack: remind.value.counterpartySlackUserId,
    });
  }

  const settle = parseBillSettle(trimmed);
  if (settle.ok) {
    const other = await findStaffBySurface(db, "slack", settle.value.counterpartySlackUserId);
    if (other === null) return { reply: replyFor("unknown_participant") };
    const recorded = await recordSettlement(db, {
      grants,
      fromStaffId: actorStaffId,
      toStaffId: requireStaffId(other.staffId),
      amountCents: settle.value.amountCents,
      currency: settle.value.currency,
      note: settle.value.note,
      surface: "slack",
      channelId,
      threadRef: input.threadRef ?? null,
      createdByStaffId: actorStaffId,
      idempotencyKey: `slack:bill_settle:${input.triggerId}`,
    });
    if (!recorded.ok) return { reply: replyFor(recorded.reason) };
    const card = settleAckCard({
      fromLabel: await labelStaff(db, actorStaffId),
      toLabel: await labelStaff(db, requireStaffId(other.staffId)),
      amountLabel: formatCents(settle.value.amountCents, settle.value.currency),
    });
    const tally = await buildTallyReply(db, grants, {
      surface: "slack",
      channelId,
      channelLabel: findGrant(grants, "slack", channelId)?.name ?? channelId,
    });
    return {
      reply: `Recorded settle. ${tally.reply}`,
      card: tally.card ?? card,
      threadRef: input.threadRef,
    };
  }

  const expense = parseBillExpense(trimmed);
  if (!expense.ok) return { reply: replyFor(expense.reason) };
  return proposeFromParsed(db, grants, {
    parsed: expense.value,
    actorStaffId,
    actorSlackUserId: slackUserId,
    channelId,
    triggerId: input.triggerId,
    threadRef: input.threadRef ?? null,
    receiptUri: null,
    mediaIndexId: null,
  });
}

async function proposeFromParsed(
  db: Db,
  grants: readonly ChannelGrant[],
  input: {
    parsed: {
      amountCents: number;
      currency: string;
      merchant: string | null;
      note: string | null;
      payerSlackUserId: import("./domain.ts").SlackUserId | null;
      participantSlackUserIds: import("./domain.ts").SlackUserId[];
      confidence: import("./bill_domain.ts").ParseConfidence;
    };
    actorStaffId: StaffId;
    actorSlackUserId: string;
    channelId: import("./domain.ts").ChannelId;
    triggerId: string;
    threadRef: string | null;
    receiptUri: string | null;
    mediaIndexId: string | null;
  },
): Promise<BillHandlerReply> {
  let payerStaffId = input.actorStaffId;
  if (input.parsed.payerSlackUserId !== null) {
    const payer = await findStaffBySurface(db, "slack", input.parsed.payerSlackUserId);
    if (payer === null) return { reply: replyFor("unknown_participant") };
    payerStaffId = requireStaffId(payer.staffId);
  }

  const others = await resolveSlackParticipants(db, input.parsed.participantSlackUserIds);
  if (!others.ok) return { reply: replyFor(others.reason) };

  // If no participants, treat as payer-only (ambiguous) equal-1 share
  const shareRows = buildEqualShareRows(input.parsed.amountCents, payerStaffId, others.value);
  const confidence =
    input.parsed.participantSlackUserIds.length === 0 || input.parsed.confidence === "ambiguous"
      ? "ambiguous"
      : "high";

  const proposed = await proposeExpense(db, {
    grants,
    payerStaffId,
    createdByStaffId: input.actorStaffId,
    amountCents: input.parsed.amountCents,
    currency: input.parsed.currency,
    merchant: input.parsed.merchant,
    note: input.parsed.note,
    shares: shareRows.map((s) => ({ staffId: s.staffId as StaffId, shareCents: s.shareCents })),
    surface: "slack",
    channelId: input.channelId,
    threadRef: input.threadRef,
    mediaIndexId: input.mediaIndexId,
    receiptUri: input.receiptUri,
    parseConfidence: confidence,
    idempotencyKey: `slack:bill_expense:${input.triggerId}`,
    autoConfirmIfHigh: false, // always confirm card
  });
  if (!proposed.ok) return { reply: replyFor(proposed.reason) };

  const exp = proposed.value.expense;
  const card = expenseConfirmCard({
    expenseId: exp.id,
    amountLabel: formatCents(exp.amountCents, exp.currency),
    payerLabel: await labelStaff(db, exp.payerStaffId),
    shareLines: await shareLinesFor(db, exp.shares, exp.currency),
    merchant: exp.merchant,
    confidence,
    receiptNote: exp.receiptUri,
  });
  return {
    reply:
      confidence === "ambiguous"
        ? "Ambiguous parse — confirm card posted (not committed)."
        : "Expense draft — confirm card posted (not committed).",
    card,
    threadRef: input.threadRef,
  };
}

async function buildTallyReply(
  db: Db,
  grants: readonly ChannelGrant[],
  input: { surface: "slack" | "telegram"; channelId: string; channelLabel: string },
): Promise<BillHandlerReply> {
  const { balances } = await loadChannelBalances(db, {
    surface: input.surface,
    channelId: input.channelId,
  });
  const { lines, suggestions } = await formatTallyLines(db, balances);
  const card = tallyCard({
    channelLabel: input.channelLabel,
    balanceLines: lines.join("\n"),
    suggestionLines: suggestions.map((s) => `• ${s}`).join("\n"),
  });
  return { reply: `Tally for ${input.channelLabel}`, card };
}

async function handleRemind(
  db: Db,
  grants: readonly ChannelGrant[],
  input: {
    channelId: import("./domain.ts").ChannelId;
    actorStaffId: StaffId;
    counterpartySlack: string | null;
  },
): Promise<BillHandlerReply> {
  const { balances } = await loadChannelBalances(db, {
    surface: "slack",
    channelId: input.channelId,
  });
  if (input.counterpartySlack !== null) {
    const staff = await findStaffBySurface(db, "slack", input.counterpartySlack);
    if (staff === null) return { reply: replyFor("unknown_participant") };
    const cents = balances.get(staff.staffId) ?? 0;
    const label = await labelStaff(db, requireStaffId(staff.staffId));
    if (cents >= 0) {
      return { reply: `${label} does not currently owe on this channel tally.` };
    }
    return {
      reply: `Reminder: ${label} owes ${formatCents(-cents)} on this channel.`,
    };
  }
  const debtors: string[] = [];
  for (const [id, cents] of balances) {
    if (cents < 0) {
      debtors.push(`${await labelStaff(db, id as StaffId)} owes ${formatCents(-cents)}`);
    }
  }
  if (debtors.length === 0) return { reply: "No open debts on this channel." };
  return { reply: `Reminders:\n${debtors.map((d) => `• ${d}`).join("\n")}` };
}

export async function handleBillCardAction(
  db: Db,
  input: { actionId: string; expenseId: string; slackUserId: string; actionTs: string },
): Promise<{ recorded: boolean; card?: SlackCard; reply?: string }> {
  const expenseId = parseExpenseId(input.expenseId);
  const slackUserId = parseSlackUserId(input.slackUserId);
  if (expenseId === null || slackUserId === null || input.actionTs.trim() === "") {
    return { recorded: false, reply: replyFor("bad_payload") };
  }
  const staff = await findStaffBySurface(db, "slack", slackUserId);
  if (staff === null) return { recorded: false, reply: replyFor("unknown_staff") };
  const staffId = requireStaffId(staff.staffId);

  if (input.actionId === "bill.confirm") {
    const result = await confirmExpense(db, { expenseId, staffId });
    if (!result.ok) return { recorded: false, reply: replyFor(result.reason) };
    const exp = result.value.expense;
    const summary = `${formatCents(exp.amountCents, exp.currency)}${exp.merchant ? ` @ ${exp.merchant}` : ""} — confirmed.`;
    return { recorded: true, card: resolvedBillCard({ decision: "confirm", summary }) };
  }
  if (input.actionId === "bill.reject") {
    const result = await voidExpense(db, { expenseId, staffId });
    if (!result.ok) return { recorded: false, reply: replyFor(result.reason) };
    return {
      recorded: true,
      card: resolvedBillCard({ decision: "reject", summary: "Expense rejected — not committed." }),
    };
  }
  if (input.actionId === "bill.remind") {
    return { recorded: true, reply: "Use `/bird remind` or `remind <@user>` in-channel for debtors." };
  }
  if (input.actionId === "bill.mark_paid") {
    return {
      recorded: true,
      reply: "Use `/bird paid <@user> <amount>` or `settle <@user> <amount>` to record a settle.",
    };
  }
  return { recorded: false };
}

/**
 * Receipt image path: store URI in media_index, LLM/heuristic extract, confirm card.
 * Does not auto-commit.
 */
export async function handleReceiptImage(
  db: Db,
  grants: readonly ChannelGrant[],
  input: {
    slackUserId: string;
    channelId: string;
    fileId: string;
    fileUrlPrivate?: string | null;
    mimeHint?: string | null;
    caption?: string | null;
    triggerId: string;
    threadRef?: string | null;
    participantSlackUserIds?: string[];
  },
): Promise<BillHandlerReply> {
  const channelId = parseSlackChannelId(input.channelId);
  const slackUserId = parseSlackUserId(input.slackUserId);
  if (channelId === null || slackUserId === null) return { reply: replyFor("bad_payload") };
  if (findGrant(grants, "slack", channelId) === null) {
    return { reply: replyFor("channel_not_allowlisted") };
  }
  const actor = await findStaffBySurface(db, "slack", slackUserId);
  if (actor === null) return { reply: replyFor("unknown_staff") };
  const actorStaffId = requireStaffId(actor.staffId);

  const receiptUri = `slack://${input.fileId}`;
  let mediaIndexId: string | null = null;
  try {
    const media = await recordMediaIndex(db.query, {
      source: "slack",
      external_jid: `slack:file:${input.fileId}`,
      occurred_at: new Date().toISOString(),
      tags: ["receipt", "bill-split"],
      staff_id: actorStaffId,
      slack_file_ref: input.fileId,
      mime_hint: input.mimeHint ?? null,
      notes: "bill-split receipt",
    });
    mediaIndexId = media.id;
  } catch {
    // Idempotent re-upload or missing 002 mig in some harnesses — keep URI only.
  }

  const extract = await extractReceipt({
    text: input.caption ?? "",
    imageUrl: input.fileUrlPrivate ?? undefined,
  });

  if (extract.amountCents === null) {
    return {
      reply:
        "Receipt saved (URI only). Could not extract amount — reply with `split <amount> with <@user>…`.",
    };
  }

  const mentionIds = (input.participantSlackUserIds ?? [])
    .map((id) => parseSlackUserId(id))
    .filter((id): id is NonNullable<typeof id> => id !== null);

  return proposeFromParsed(db, grants, {
    parsed: {
      amountCents: extract.amountCents,
      currency: extract.currency,
      merchant: extract.merchant,
      note: input.caption ?? null,
      payerSlackUserId: null,
      participantSlackUserIds: mentionIds,
      confidence: extract.confidence,
    },
    actorStaffId,
    actorSlackUserId: slackUserId,
    channelId,
    triggerId: input.triggerId,
    threadRef: input.threadRef ?? null,
    receiptUri,
    mediaIndexId,
  });
}
