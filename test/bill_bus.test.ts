import { expect, test } from "bun:test";
import { linkStaff } from "../src/bus.ts";
import {
  confirmExpense,
  loadChannelBalances,
  proposeExpense,
  recordSettlement,
  voidExpense,
} from "../src/bill_bus.ts";
import { equalShares } from "../src/bill_math.ts";
import { handleBillCommand, handleBillCardAction } from "../src/bill_handlers.ts";
import { freshDb } from "./harness.ts";
import { slackChannel, slackGrants, slackUser, staffA, staffB } from "./fixtures.ts";
import { parseSlackUserId, parseStaffId } from "../src/domain.ts";

const staffC = parseStaffId("33333333-3333-4333-8333-333333333333");
const slackB = parseSlackUserId("U0STAFF2");
if (staffC === null || slackB === null) throw new Error("fixtures");

async function seed(db: Awaited<ReturnType<typeof freshDb>>) {
  await linkStaff(db, {
    staffId: staffA,
    employment: "full_time",
    slackUserId: slackUser,
    telegramUserId: null,
    displayName: "Alice",
  });
  await linkStaff(db, {
    staffId: staffB,
    employment: "full_time",
    slackUserId: slackB,
    telegramUserId: null,
    displayName: "Bob",
  });
}

test("propose stays pending; confirm then balances; settle flats", async () => {
  const db = await freshDb();
  await seed(db);
  const shares = equalShares(10000, [staffA, staffB]).map((s) => ({
    staffId: s.staffId as typeof staffA,
    shareCents: s.shareCents,
  }));
  const proposed = await proposeExpense(db, {
    grants: slackGrants,
    payerStaffId: staffA,
    createdByStaffId: staffA,
    amountCents: 10000,
    shares,
    surface: "slack",
    channelId: slackChannel,
    parseConfidence: "ambiguous",
    idempotencyKey: "test:exp:1",
  });
  expect(proposed.ok).toBe(true);
  if (!proposed.ok) return;
  expect(proposed.value.expense.status).toBe("pending_confirm");

  let bal = await loadChannelBalances(db, { surface: "slack", channelId: slackChannel });
  expect(bal.balances.size).toBe(0); // pending ignored

  const confirmed = await confirmExpense(db, {
    expenseId: proposed.value.expense.id,
    staffId: staffA,
  });
  expect(confirmed.ok).toBe(true);

  bal = await loadChannelBalances(db, { surface: "slack", channelId: slackChannel });
  expect(bal.balances.get(staffA)).toBe(5000);
  expect(bal.balances.get(staffB)).toBe(-5000);

  const settled = await recordSettlement(db, {
    grants: slackGrants,
    fromStaffId: staffB,
    toStaffId: staffA,
    amountCents: 5000,
    surface: "slack",
    channelId: slackChannel,
    createdByStaffId: staffB,
    idempotencyKey: "test:settle:1",
  });
  expect(settled.ok).toBe(true);
  bal = await loadChannelBalances(db, { surface: "slack", channelId: slackChannel });
  expect(bal.balances.size).toBe(0);
});

test("void pending expense", async () => {
  const db = await freshDb();
  await seed(db);
  const shares = equalShares(2000, [staffA]).map((s) => ({
    staffId: s.staffId as typeof staffA,
    shareCents: s.shareCents,
  }));
  const proposed = await proposeExpense(db, {
    grants: slackGrants,
    payerStaffId: staffA,
    createdByStaffId: staffA,
    amountCents: 2000,
    shares,
    surface: "slack",
    channelId: slackChannel,
    parseConfidence: "ambiguous",
    idempotencyKey: "test:exp:void",
  });
  if (!proposed.ok) throw new Error("propose");
  const voided = await voidExpense(db, { expenseId: proposed.value.expense.id, staffId: staffA });
  expect(voided.ok).toBe(true);
  const again = await confirmExpense(db, {
    expenseId: proposed.value.expense.id,
    staffId: staffA,
  });
  expect(again.ok).toBe(false);
});

test("handler allowlist gate + confirm card action", async () => {
  const db = await freshDb();
  await seed(db);
  const denied = await handleBillCommand(db, slackGrants, {
    text: "split 10 lunch with <@U0STAFF2>",
    slackUserId: slackUser,
    channelId: "C0NOTALLOW",
    triggerId: "trig-deny",
  });
  expect(denied.reply).toContain("not allowlisted");

  const ok = await handleBillCommand(db, slackGrants, {
    text: "split 10 lunch with <@U0STAFF2>",
    slackUserId: slackUser,
    channelId: slackChannel,
    triggerId: "trig-ok",
  });
  expect(ok.card).toBeDefined();
  expect(ok.reply).toMatch(/confirm card|Ambiguous|draft/i);

  const expenseId = ok.card?.blocks
    .flatMap((b) => ("block_id" in b && typeof b.block_id === "string" ? [b.block_id] : []))
    .find((id) => id.startsWith("bill."))
    ?.replace("bill.", "");
  expect(expenseId).toBeTruthy();
  const action = await handleBillCardAction(db, {
    actionId: "bill.confirm",
    expenseId: expenseId!,
    slackUserId: slackUser,
    actionTs: "1.0",
  });
  expect(action.recorded).toBe(true);
});

test("channel not allowlisted for proposeExpense", async () => {
  const db = await freshDb();
  await seed(db);
  const result = await proposeExpense(db, {
    grants: slackGrants,
    payerStaffId: staffA,
    createdByStaffId: staffA,
    amountCents: 100,
    shares: [{ staffId: staffA, shareCents: 100 }],
    surface: "slack",
    channelId: "C0NOTALLOW" as typeof slackChannel,
    parseConfidence: "high",
    idempotencyKey: "x",
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("channel_not_allowlisted");
});
