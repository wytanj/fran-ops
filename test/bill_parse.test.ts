import { expect, test } from "bun:test";
import { parseMoneyToCents } from "../src/bill_domain.ts";
import {
  looksLikeBillCommand,
  parseBillExpense,
  parseBillRemind,
  parseBillSettle,
  parseBillTally,
} from "../src/bill_parse.ts";
import { parseSlackUserId } from "../src/domain.ts";

const u2 = parseSlackUserId("U0STAFF2");
const u3 = parseSlackUserId("U0STAFF3");
if (u2 === null || u3 === null) throw new Error("fixture slack ids");

test("parseMoneyToCents", () => {
  expect(parseMoneyToCents("12.50")).toBe(1250);
  expect(parseMoneyToCents("$12")).toBe(1200);
  expect(parseMoneyToCents("0.01")).toBe(1);
  expect(parseMoneyToCents("0")).toBe(null);
  expect(parseMoneyToCents("12.999")).toBe(null);
});

test("parseBillExpense equal split with mentions", () => {
  const parsed = parseBillExpense("split 45.50 lunch with <@U0STAFF2> <@U0STAFF3>");
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.amountCents).toBe(4550);
  expect(parsed.value.merchant).toBe("lunch");
  expect(parsed.value.participantSlackUserIds).toEqual([u2, u3]);
  expect(parsed.value.confidence).toBe("high");
});

test("parseBillExpense without participants is ambiguous", () => {
  const parsed = parseBillExpense("expense 20 coffee");
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.confidence).toBe("ambiguous");
  expect(parsed.value.participantSlackUserIds).toEqual([]);
});

test("parseBillSettle and remind and tally", () => {
  const s = parseBillSettle("paid <@U0STAFF2> 20.00");
  expect(s.ok).toBe(true);
  if (s.ok) expect(s.value.amountCents).toBe(2000);

  const r = parseBillRemind("remind <@U0STAFF2>");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value.counterpartySlackUserId).toBe(u2);

  expect(parseBillTally("tally")).toBe(true);
  expect(parseBillTally("balances")).toBe(true);
  expect(looksLikeBillCommand("split 10")).toBe(true);
  expect(looksLikeBillCommand("tell <@U0X> hi")).toBe(false);
});
