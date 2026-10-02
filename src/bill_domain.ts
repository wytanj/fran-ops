/**
 * Bill-split / Splitwise-lite domain types.
 * Balances are derived (bill_math); DB stores expenses, shares, settlements.
 */

declare const expenseIdBrand: unique symbol;
declare const settlementIdBrand: unique symbol;

export type ExpenseId = string & { readonly [expenseIdBrand]: "ExpenseId" };
export type SettlementId = string & { readonly [settlementIdBrand]: "SettlementId" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EXPENSE_STATUSES = ["pending_confirm", "confirmed", "void"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const SPLIT_MODES = ["equal", "exact"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

export const PARSE_CONFIDENCES = ["high", "ambiguous"] as const;
export type ParseConfidence = (typeof PARSE_CONFIDENCES)[number];

export const BILL_CARD_TEMPLATES = ["expense_confirm", "tally", "settle_ack"] as const;
export type BillCardTemplate = (typeof BILL_CARD_TEMPLATES)[number];

export type BillReason =
  | "bad_bill"
  | "ambiguous_bill"
  | "unknown_participant"
  | "share_mismatch"
  | "unknown_expense"
  | "expense_not_pending"
  | "expense_not_confirmed"
  | "channel_not_allowlisted"
  | "unknown_staff"
  | "bad_payload";

export type BillOk<T> = { ok: true; value: T };
export type BillErr = { ok: false; reason: BillReason };
export type BillResult<T> = BillOk<T> | BillErr;

export function parseExpenseId(raw: string): ExpenseId | null {
  if (!UUID_RE.test(raw)) return null;
  return raw.toLowerCase() as ExpenseId;
}

export function parseSettlementId(raw: string): SettlementId | null {
  if (!UUID_RE.test(raw)) return null;
  return raw.toLowerCase() as SettlementId;
}

/** Parse dollars/cents string → integer cents. Accepts 12, 12.5, 12.50, $12.50. */
export function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const dollars = Number(whole);
  if (!Number.isInteger(dollars) || dollars < 0) return null;
  const fracPadded = (frac + "00").slice(0, 2);
  const centsPart = Number(fracPadded);
  if (!Number.isInteger(centsPart)) return null;
  const total = dollars * 100 + centsPart;
  if (total <= 0) return null;
  return total;
}

export function formatCents(cents: number, currency = "SGD"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${currency} ${whole}.${frac}`;
}
