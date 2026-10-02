import { expect, test } from "bun:test";
import {
  applyExpense,
  applySettlement,
  computeBalances,
  equalShares,
  sharesSumOk,
  suggestSettlements,
} from "../src/bill_math.ts";

test("equalShares distributes remainder to first participants", () => {
  expect(equalShares(100, ["a", "b", "c"])).toEqual([
    { staffId: "a", shareCents: 34 },
    { staffId: "b", shareCents: 33 },
    { staffId: "c", shareCents: 33 },
  ]);
  expect(sharesSumOk(100, equalShares(100, ["a", "b", "c"]))).toBe(true);
});

test("computeBalances: payer owed by others after equal split", () => {
  const balances = computeBalances([
    {
      payerStaffId: "alice",
      amountCents: 9000,
      shares: equalShares(9000, ["alice", "bob", "cara"]),
    },
  ]);
  expect(balances.get("alice")).toBe(6000); // paid 90, share 30 → +60
  expect(balances.get("bob")).toBe(-3000);
  expect(balances.get("cara")).toBe(-3000);
});

test("settlement reduces balances; suggestSettlements clears", () => {
  const balances = computeBalances(
    [
      {
        payerStaffId: "alice",
        amountCents: 10000,
        shares: equalShares(10000, ["alice", "bob"]),
      },
    ],
    [{ fromStaffId: "bob", toStaffId: "alice", amountCents: 5000 }],
  );
  expect(balances.size).toBe(0);

  const open = computeBalances([
    {
      payerStaffId: "a",
      amountCents: 3000,
      shares: equalShares(3000, ["a", "b", "c"]),
    },
  ]);
  const transfers = suggestSettlements(open);
  let sim = new Map(open);
  for (const t of transfers) applySettlement(sim, t);
  for (const v of sim.values()) expect(v).toBe(0);
});

test("applyExpense throws on share mismatch", () => {
  const m = new Map<string, number>();
  expect(() =>
    applyExpense(m, {
      payerStaffId: "a",
      amountCents: 100,
      shares: [{ staffId: "a", shareCents: 40 }],
    }),
  ).toThrow(/share_mismatch/);
});
