/**
 * Parse bill-split slash/freeform text.
 * Ambiguous parses return ok with confidence=ambiguous (caller shows confirm card).
 * Never auto-commits.
 */

import {
  parseMoneyToCents,
  type BillResult,
  type ParseConfidence,
  type SplitMode,
} from "./bill_domain.ts";
import { equalShares } from "./bill_math.ts";
import { parseSlackUserId, type SlackUserId } from "./domain.ts";

export type ParsedExpense = {
  amountCents: number;
  currency: string;
  merchant: string | null;
  note: string | null;
  payerSlackUserId: SlackUserId | null; // null → actor is payer
  participantSlackUserIds: SlackUserId[];
  splitMode: SplitMode;
  confidence: ParseConfidence;
  /** Precomputed equal shares by slack id (exact amounts filled later after staff resolve). */
  equalParticipantCount: number;
};

export type ParsedSettle = {
  counterpartySlackUserId: SlackUserId;
  amountCents: number;
  currency: string;
  /** true = actor paid counterparty (mark paid / settle) */
  actorPaidThem: boolean;
  note: string | null;
  confidence: ParseConfidence;
};

export type ParsedRemind = {
  counterpartySlackUserId: SlackUserId | null; // null → remind all debtors
};

const CURRENCY = "SGD";

function extractSlackMentions(text: string): SlackUserId[] {
  const out: SlackUserId[] = [];
  const seen = new Set<string>();
  const re = /<@(U[A-Z0-9]+)(?:\|[^>]+)?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = parseSlackUserId(m[1]!);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function stripMentions(text: string): string {
  return text.replace(/<@U[A-Z0-9]+(?:\|[^>]+)?>/g, " ").replace(/\s+/g, " ").trim();
}

/** Detect bill intent keywords so handlers can claim the text. */
export function looksLikeBillCommand(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  return /^(?:split|expense|bill|tally|balances?|settle|paid|mark\s+paid|remind)\b/i.test(t);
}

export function parseBillExpense(text: string): BillResult<ParsedExpense> {
  let t = text.trim();
  t = t.replace(/^(?:split|expense|bill)\b[:,]?\s*/i, "").trim();
  if (t.length === 0) return { ok: false, reason: "bad_bill" };

  const mentions = extractSlackMentions(t);
  const stripped = stripMentions(t);

  // Amount: first money-like token
  const moneyMatch = stripped.match(/\$?\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?/);
  if (moneyMatch === null) return { ok: false, reason: "bad_bill" };
  const amountCents = parseMoneyToCents(moneyMatch[0]);
  if (amountCents === null) return { ok: false, reason: "bad_bill" };

  let rest = stripped.replace(moneyMatch[0], " ").replace(/\s+/g, " ").trim();
  // Drop filler words
  rest = rest
    .replace(/^(?:for|on|at)\s+/i, "")
    .replace(/\b(?:with|split\s+with|between|among)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  let merchant: string | null = null;
  let note: string | null = null;
  if (rest.length > 0) {
    // First phrase as merchant if short; else note
    if (rest.length <= 48 && !/\s{2,}/.test(rest)) {
      merchant = rest;
    } else {
      note = rest;
      merchant = rest.split(/\s+/).slice(0, 3).join(" ") || null;
    }
  }

  // Payer override: "I paid" / "paid by @X" — default actor
  let payerSlackUserId: SlackUserId | null = null;
  const paidBy = text.match(/\bpaid\s+by\s+<@(U[A-Z0-9]+)(?:\|[^>]+)?>/i);
  if (paidBy?.[1]) {
    payerSlackUserId = parseSlackUserId(paidBy[1]);
  }

  const participants = mentions.filter((id) => id !== payerSlackUserId);
  let confidence: ParseConfidence = "high";
  if (participants.length === 0) {
    // Split with no participants → ambiguous (need who shares)
    confidence = "ambiguous";
  }
  if (merchant === null && note === null) confidence = "ambiguous";

  // Include payer in equal split set at resolve time; here we only list others (+ optional self)
  return {
    ok: true,
    value: {
      amountCents,
      currency: CURRENCY,
      merchant,
      note,
      payerSlackUserId,
      participantSlackUserIds: participants,
      splitMode: "equal",
      confidence,
      equalParticipantCount: Math.max(1, participants.length + 1), // +payer
    },
  };
}

export function parseBillSettle(text: string): BillResult<ParsedSettle> {
  let t = text.trim();
  const markPaid = /^(?:mark\s+paid|paid|settle)\b[:,]?\s*/i.test(t);
  if (!markPaid) return { ok: false, reason: "bad_bill" };
  t = t.replace(/^(?:mark\s+paid|paid|settle)\b[:,]?\s*/i, "").trim();

  const mentions = extractSlackMentions(t);
  if (mentions.length === 0) return { ok: false, reason: "bad_bill" };
  const counterparty = mentions[0]!;
  const stripped = stripMentions(t);
  const moneyMatch = stripped.match(/\$?\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?/);
  if (moneyMatch === null) return { ok: false, reason: "bad_bill" };
  const amountCents = parseMoneyToCents(moneyMatch[0]);
  if (amountCents === null) return { ok: false, reason: "bad_bill" };

  let note = stripped.replace(moneyMatch[0], " ").replace(/\s+/g, " ").trim() || null;
  if (note !== null && /^(?:to|from)$/i.test(note)) note = null;

  return {
    ok: true,
    value: {
      counterpartySlackUserId: counterparty,
      amountCents,
      currency: CURRENCY,
      actorPaidThem: true,
      note,
      confidence: "high",
    },
  };
}

export function parseBillRemind(text: string): BillResult<ParsedRemind> {
  let t = text.trim();
  if (!/^remind\b/i.test(t)) return { ok: false, reason: "bad_bill" };
  t = t.replace(/^remind\b[:,]?\s*/i, "").trim();
  const mentions = extractSlackMentions(t);
  return {
    ok: true,
    value: { counterpartySlackUserId: mentions[0] ?? null },
  };
}

export function parseBillTally(text: string): boolean {
  return /^(?:tally|balances?)\b/i.test(text.trim());
}

/** Build equal share rows once staff ids are known (payer first). */
export function buildEqualShareRows(
  amountCents: number,
  payerStaffId: string,
  otherStaffIds: readonly string[],
): Array<{ staffId: string; shareCents: number }> {
  const ordered = [payerStaffId, ...otherStaffIds.filter((id) => id !== payerStaffId)];
  return equalShares(amountCents, ordered);
}
