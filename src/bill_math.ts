/**
 * Pure balance + settle math for bill-split.
 * Net[staff] > 0 means others owe them (creditor); < 0 means they owe (debtor).
 */

export type ExpenseShareInput = {
  payerStaffId: string;
  amountCents: number;
  shares: ReadonlyArray<{ staffId: string; shareCents: number }>;
};

export type SettlementInput = {
  fromStaffId: string;
  toStaffId: string;
  amountCents: number;
};

export type BalanceMap = Map<string, number>;

export type Transfer = {
  fromStaffId: string;
  toStaffId: string;
  amountCents: number;
};

/** Validate shares sum to amount. */
export function sharesSumOk(
  amountCents: number,
  shares: ReadonlyArray<{ shareCents: number }>,
): boolean {
  if (amountCents <= 0 || shares.length === 0) return false;
  let sum = 0;
  for (const s of shares) {
    if (s.shareCents < 0) return false;
    sum += s.shareCents;
  }
  return sum === amountCents;
}

/** Equal split with remainder cents going to first participants. */
export function equalShares(
  amountCents: number,
  staffIds: readonly string[],
): Array<{ staffId: string; shareCents: number }> {
  if (amountCents <= 0 || staffIds.length === 0) return [];
  const n = staffIds.length;
  const base = Math.floor(amountCents / n);
  let rem = amountCents - base * n;
  return staffIds.map((staffId) => {
    const extra = rem > 0 ? 1 : 0;
    if (rem > 0) rem -= 1;
    return { staffId, shareCents: base + extra };
  });
}

/**
 * Apply one confirmed expense: payer gains +amount, each share holder loses their share.
 * Net effect: participants who didn't pay owe the payer.
 */
export function applyExpense(balances: BalanceMap, expense: ExpenseShareInput): void {
  if (!sharesSumOk(expense.amountCents, expense.shares)) {
    throw new Error("share_mismatch");
  }
  bump(balances, expense.payerStaffId, expense.amountCents);
  for (const s of expense.shares) {
    bump(balances, s.staffId, -s.shareCents);
  }
}

/** from paid to: from debt decreases, to credit decreases. */
export function applySettlement(balances: BalanceMap, settle: SettlementInput): void {
  if (settle.amountCents <= 0) throw new Error("bad settle amount");
  if (settle.fromStaffId === settle.toStaffId) throw new Error("self settle");
  bump(balances, settle.fromStaffId, settle.amountCents);
  bump(balances, settle.toStaffId, -settle.amountCents);
}

export function computeBalances(
  expenses: readonly ExpenseShareInput[],
  settlements: readonly SettlementInput[] = [],
): BalanceMap {
  const balances: BalanceMap = new Map();
  for (const e of expenses) applyExpense(balances, e);
  for (const s of settlements) applySettlement(balances, s);
  // Drop zeros
  for (const [id, cents] of [...balances.entries()]) {
    if (cents === 0) balances.delete(id);
  }
  return balances;
}

/**
 * Greedy pairwise settle suggestions: largest debtor pays largest creditor until flat.
 * Deterministic: sort by |cents| desc, then staffId asc.
 */
export function suggestSettlements(balances: BalanceMap): Transfer[] {
  const debtors: Array<{ id: string; cents: number }> = [];
  const creditors: Array<{ id: string; cents: number }> = [];
  for (const [id, cents] of balances) {
    if (cents < 0) debtors.push({ id, cents });
    else if (cents > 0) creditors.push({ id, cents });
  }
  const byMag = (a: { id: string; cents: number }, b: { id: string; cents: number }) => {
    const d = Math.abs(b.cents) - Math.abs(a.cents);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  };
  debtors.sort(byMag);
  creditors.sort(byMag);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]!;
    const c = creditors[j]!;
    const amount = Math.min(-d.cents, c.cents);
    if (amount > 0) {
      transfers.push({ fromStaffId: d.id, toStaffId: c.id, amountCents: amount });
      d.cents += amount;
      c.cents -= amount;
    }
    if (d.cents === 0) i += 1;
    if (c.cents === 0) j += 1;
  }
  return transfers;
}

function bump(map: BalanceMap, staffId: string, delta: number): void {
  map.set(staffId, (map.get(staffId) ?? 0) + delta);
}
