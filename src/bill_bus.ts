/**
 * Bill-split DB ops. Single SoT for Slack + Telegram.
 * Ambiguous / writes stay pending_confirm until confirmExpense.
 */

import { findGrant, type ChannelGrant } from "./allowlist.ts";
import { findStaffById, findStaffBySurface } from "./bus.ts";
import {
  formatCents,
  parseExpenseId,
  type BillResult,
  type ExpenseId,
  type ExpenseStatus,
  type ParseConfidence,
  type SplitMode,
} from "./bill_domain.ts";
import { computeBalances, sharesSumOk, suggestSettlements, type BalanceMap } from "./bill_math.ts";
import type { Db } from "./db.ts";
import {
  formatStaffLabel,
  type ChannelId,
  type StaffId,
  type Surface,
} from "./domain.ts";

export type BillShareRow = { staffId: StaffId; shareCents: number };

export type BillExpenseRow = {
  id: ExpenseId;
  payerStaffId: StaffId;
  amountCents: number;
  currency: string;
  merchant: string | null;
  note: string | null;
  splitMode: SplitMode;
  status: ExpenseStatus;
  surface: Surface;
  channelId: string;
  threadRef: string | null;
  mediaIndexId: string | null;
  receiptUri: string | null;
  parseConfidence: ParseConfidence;
  createdByStaffId: StaffId;
  shares: BillShareRow[];
};

export type ProposeExpenseInput = {
  grants: readonly ChannelGrant[];
  payerStaffId: StaffId;
  createdByStaffId: StaffId;
  amountCents: number;
  currency?: string;
  merchant?: string | null;
  note?: string | null;
  splitMode?: SplitMode;
  shares: BillShareRow[];
  surface: Surface;
  channelId: ChannelId;
  threadRef?: string | null;
  mediaIndexId?: string | null;
  receiptUri?: string | null;
  parseConfidence: ParseConfidence;
  idempotencyKey: string;
  /** If confidence high AND forceConfirm, skip pending. Default: ambiguous → pending. */
  autoConfirmIfHigh?: boolean;
};

function mapExpense(
  row: {
    id: string;
    payer_staff_id: string;
    amount_cents: string | number;
    currency: string;
    merchant: string | null;
    note: string | null;
    split_mode: string;
    status: string;
    surface: string;
    channel_id: string;
    thread_ref: string | null;
    media_index_id: string | null;
    receipt_uri: string | null;
    parse_confidence: string;
    created_by_staff_id: string;
  },
  shares: BillShareRow[],
): BillExpenseRow {
  const id = parseExpenseId(row.id);
  if (id === null) throw new Error("bad expense id");
  return {
    id,
    payerStaffId: row.payer_staff_id as StaffId,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    merchant: row.merchant,
    note: row.note,
    splitMode: row.split_mode as SplitMode,
    status: row.status as ExpenseStatus,
    surface: row.surface as Surface,
    channelId: row.channel_id,
    threadRef: row.thread_ref,
    mediaIndexId: row.media_index_id,
    receiptUri: row.receipt_uri,
    parseConfidence: row.parse_confidence as ParseConfidence,
    createdByStaffId: row.created_by_staff_id as StaffId,
    shares,
  };
}

export async function proposeExpense(
  db: Db,
  input: ProposeExpenseInput,
): Promise<BillResult<{ expense: BillExpenseRow; created: boolean }>> {
  const grant = findGrant(input.grants, input.surface, input.channelId);
  if (grant === null) return { ok: false, reason: "channel_not_allowlisted" };
  if (!(await findStaffById(db, input.payerStaffId))) return { ok: false, reason: "unknown_staff" };
  if (!(await findStaffById(db, input.createdByStaffId))) return { ok: false, reason: "unknown_staff" };
  for (const s of input.shares) {
    if (!(await findStaffById(db, s.staffId))) return { ok: false, reason: "unknown_participant" };
  }
  if (!sharesSumOk(input.amountCents, input.shares)) return { ok: false, reason: "share_mismatch" };

  const autoConfirm =
    input.autoConfirmIfHigh === true && input.parseConfidence === "high";
  const status: ExpenseStatus = autoConfirm ? "confirmed" : "pending_confirm";
  const confirmedAt = autoConfirm ? new Date().toISOString() : null;

  return db.transaction(async (query) => {
    const inserted = await query<{
      id: string;
      payer_staff_id: string;
      amount_cents: string | number;
      currency: string;
      merchant: string | null;
      note: string | null;
      split_mode: string;
      status: string;
      surface: string;
      channel_id: string;
      thread_ref: string | null;
      media_index_id: string | null;
      receipt_uri: string | null;
      parse_confidence: string;
      created_by_staff_id: string;
    }>(
      `insert into bill_expenses (
         payer_staff_id, amount_cents, currency, merchant, note, split_mode, status,
         surface, channel_id, thread_ref, media_index_id, receipt_uri, parse_confidence,
         created_by_staff_id, idempotency_key, confirmed_at
       ) values (
         $1,$2,$3,$4,$5,$6,$7,
         $8,$9,$10,$11,$12,$13,
         $14,$15,$16
       )
       on conflict (idempotency_key) do nothing
       returning *`,
      [
        input.payerStaffId,
        input.amountCents,
        input.currency ?? "SGD",
        input.merchant ?? null,
        input.note ?? null,
        input.splitMode ?? "equal",
        status,
        input.surface,
        input.channelId,
        input.threadRef ?? null,
        input.mediaIndexId ?? null,
        input.receiptUri ?? null,
        input.parseConfidence,
        input.createdByStaffId,
        input.idempotencyKey,
        confirmedAt,
      ],
    );
    const fresh = inserted[0];
    if (fresh === undefined) {
      const existing = await query<{
        id: string;
        payer_staff_id: string;
        amount_cents: string | number;
        currency: string;
        merchant: string | null;
        note: string | null;
        split_mode: string;
        status: string;
        surface: string;
        channel_id: string;
        thread_ref: string | null;
        media_index_id: string | null;
        receipt_uri: string | null;
        parse_confidence: string;
        created_by_staff_id: string;
      }>(`select * from bill_expenses where idempotency_key = $1`, [input.idempotencyKey]);
      const row = existing[0];
      if (row === undefined) throw new Error("missing bill expense");
      const shares = await loadShares(query, row.id);
      return { ok: true, value: { expense: mapExpense(row, shares), created: false } };
    }
    for (const s of input.shares) {
      await query(
        `insert into bill_shares (expense_id, staff_id, share_cents) values ($1,$2,$3)`,
        [fresh.id, s.staffId, s.shareCents],
      );
    }
    return {
      ok: true,
      value: { expense: mapExpense(fresh, input.shares), created: true },
    };
  });
}

async function loadShares(
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>,
  expenseId: string,
): Promise<BillShareRow[]> {
  const rows = await query<{ staff_id: string; share_cents: string | number }>(
    `select staff_id, share_cents from bill_shares where expense_id = $1`,
    [expenseId],
  );
  return rows.map((r) => ({
    staffId: r.staff_id as StaffId,
    shareCents: Number(r.share_cents),
  }));
}

export async function confirmExpense(
  db: Db,
  input: { expenseId: ExpenseId; staffId: StaffId },
): Promise<BillResult<{ expense: BillExpenseRow }>> {
  return db.transaction(async (query) => {
    const rows = await query<{
      id: string;
      payer_staff_id: string;
      amount_cents: string | number;
      currency: string;
      merchant: string | null;
      note: string | null;
      split_mode: string;
      status: string;
      surface: string;
      channel_id: string;
      thread_ref: string | null;
      media_index_id: string | null;
      receipt_uri: string | null;
      parse_confidence: string;
      created_by_staff_id: string;
    }>(`select * from bill_expenses where id = $1 for update`, [input.expenseId]);
    const row = rows[0];
    if (row === undefined) return { ok: false, reason: "unknown_expense" };
    if (row.status !== "pending_confirm") return { ok: false, reason: "expense_not_pending" };
    await query(
      `update bill_expenses
       set status = 'confirmed', confirmed_at = now(), updated_at = now()
       where id = $1`,
      [input.expenseId],
    );
    const shares = await loadShares(query, row.id);
    return {
      ok: true,
      value: {
        expense: mapExpense({ ...row, status: "confirmed" }, shares),
      },
    };
  });
}

export async function voidExpense(
  db: Db,
  input: { expenseId: ExpenseId; staffId: StaffId },
): Promise<BillResult<{ expenseId: ExpenseId }>> {
  return db.transaction(async (query) => {
    const rows = await query<{ status: string }>(
      `select status from bill_expenses where id = $1 for update`,
      [input.expenseId],
    );
    if (rows[0] === undefined) return { ok: false, reason: "unknown_expense" };
    if (rows[0].status !== "pending_confirm") return { ok: false, reason: "expense_not_pending" };
    await query(
      `update bill_expenses set status = 'void', updated_at = now() where id = $1`,
      [input.expenseId],
    );
    return { ok: true, value: { expenseId: input.expenseId } };
  });
}

export async function recordSettlement(
  db: Db,
  input: {
    grants: readonly ChannelGrant[];
    fromStaffId: StaffId;
    toStaffId: StaffId;
    amountCents: number;
    currency?: string;
    note?: string | null;
    surface: Surface;
    channelId: ChannelId;
    threadRef?: string | null;
    createdByStaffId: StaffId;
    idempotencyKey: string;
  },
): Promise<BillResult<{ settlementId: string; created: boolean }>> {
  const grant = findGrant(input.grants, input.surface, input.channelId);
  if (grant === null) return { ok: false, reason: "channel_not_allowlisted" };
  if (input.fromStaffId === input.toStaffId) return { ok: false, reason: "bad_bill" as const };
  if (!(await findStaffById(db, input.fromStaffId))) return { ok: false, reason: "unknown_staff" };
  if (!(await findStaffById(db, input.toStaffId))) return { ok: false, reason: "unknown_participant" };
  if (input.amountCents <= 0) return { ok: false, reason: "bad_bill" as const };

  return db.transaction(async (query) => {
    const inserted = await query<{ id: string }>(
      `insert into bill_settlements (
         from_staff_id, to_staff_id, amount_cents, currency, note,
         surface, channel_id, thread_ref, created_by_staff_id, idempotency_key
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        input.fromStaffId,
        input.toStaffId,
        input.amountCents,
        input.currency ?? "SGD",
        input.note ?? null,
        input.surface,
        input.channelId,
        input.threadRef ?? null,
        input.createdByStaffId,
        input.idempotencyKey,
      ],
    );
    const fresh = inserted[0];
    if (fresh !== undefined) return { ok: true, value: { settlementId: fresh.id, created: true } };
    const existing = await query<{ id: string }>(
      `select id from bill_settlements where idempotency_key = $1`,
      [input.idempotencyKey],
    );
    const id = existing[0]?.id;
    if (id === undefined) throw new Error("missing settlement");
    return { ok: true, value: { settlementId: id, created: false } };
  });
}

export async function loadChannelBalances(
  db: Db,
  input: { surface: Surface; channelId: string },
): Promise<{ balances: BalanceMap; expenses: BillExpenseRow[]; settlementCount: number }> {
  const expenseRows = await db.query<{
    id: string;
    payer_staff_id: string;
    amount_cents: string | number;
    currency: string;
    merchant: string | null;
    note: string | null;
    split_mode: string;
    status: string;
    surface: string;
    channel_id: string;
    thread_ref: string | null;
    media_index_id: string | null;
    receipt_uri: string | null;
    parse_confidence: string;
    created_by_staff_id: string;
  }>(
    `select * from bill_expenses
     where surface = $1 and channel_id = $2 and status = 'confirmed'
     order by created_at`,
    [input.surface, input.channelId],
  );
  const expenses: BillExpenseRow[] = [];
  for (const row of expenseRows) {
    const shares = await loadShares(db.query, row.id);
    expenses.push(mapExpense(row, shares));
  }
  const settlements = await db.query<{
    from_staff_id: string;
    to_staff_id: string;
    amount_cents: string | number;
  }>(
    `select from_staff_id, to_staff_id, amount_cents from bill_settlements
     where surface = $1 and channel_id = $2
     order by created_at`,
    [input.surface, input.channelId],
  );
  const balances = computeBalances(
    expenses.map((e) => ({
      payerStaffId: e.payerStaffId,
      amountCents: e.amountCents,
      shares: e.shares.map((s) => ({ staffId: s.staffId, shareCents: s.shareCents })),
    })),
    settlements.map((s) => ({
      fromStaffId: s.from_staff_id,
      toStaffId: s.to_staff_id,
      amountCents: Number(s.amount_cents),
    })),
  );
  return { balances, expenses, settlementCount: settlements.length };
}

export async function labelStaff(db: Db, staffId: StaffId): Promise<string> {
  const identity = await findStaffById(db, staffId);
  return formatStaffLabel({
    staffId,
    displayName: identity?.displayName,
    slackUserId: identity?.slackUserId,
  });
}

export async function resolveSlackParticipants(
  db: Db,
  slackUserIds: readonly string[],
): Promise<BillResult<StaffId[]>> {
  const out: StaffId[] = [];
  for (const raw of slackUserIds) {
    const staff = await findStaffBySurface(db, "slack", raw);
    if (staff === null) return { ok: false, reason: "unknown_participant" };
    out.push(staff.staffId);
  }
  return { ok: true, value: out };
}

export async function formatTallyLines(
  db: Db,
  balances: BalanceMap,
  currency = "SGD",
): Promise<{ lines: string[]; suggestions: string[] }> {
  const lines: string[] = [];
  const entries = [...balances.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    lines.push("_All settled — balances are flat._");
  } else {
    for (const [staffId, cents] of entries) {
      const label = await labelStaff(db, staffId as StaffId);
      if (cents > 0) lines.push(`• ${label} is owed ${formatCents(cents, currency)}`);
      else lines.push(`• ${label} owes ${formatCents(-cents, currency)}`);
    }
  }
  const transfers = suggestSettlements(new Map(balances));
  const suggestions: string[] = [];
  for (const t of transfers) {
    const from = await labelStaff(db, t.fromStaffId as StaffId);
    const to = await labelStaff(db, t.toStaffId as StaffId);
    suggestions.push(`${from} → ${to}: ${formatCents(t.amountCents, currency)}`);
  }
  return { lines, suggestions };
}
