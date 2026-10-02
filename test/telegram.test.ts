import { expect, test } from "bun:test";
import { linkStaff } from "../src/bus.ts";
import {
  handleTelegramUpdate,
  loadTelegramConfig,
  parseExtraTelegramChatGrants,
  verifyTelegramSecret,
  type TelegramSender,
} from "../src/telegram.ts";
import { freshDb } from "./harness.ts";
import { staffA, telegramChannel, telegramGrants, telegramUser } from "./fixtures.ts";

test("loadTelegramConfig requires token", () => {
  expect(loadTelegramConfig({})).toBe(null);
  expect(loadTelegramConfig({ TELEGRAM_BOT_TOKEN: "tok" })?.botToken).toBe("tok");
});

test("parseExtraTelegramChatGrants + secret verify", () => {
  const grants = parseExtraTelegramChatGrants("555100:ops-tg;555200");
  expect(grants.length).toBe(2);
  expect(grants[0]?.surface).toBe("telegram");
  expect(verifyTelegramSecret("abc", "abc")).toBe(true);
  expect(verifyTelegramSecret("nope", "abc")).toBe(false);
  expect(verifyTelegramSecret(undefined, null)).toBe(true);
});

test("telegram split → pending confirm → confirm_expense", async () => {
  const db = await freshDb();
  await linkStaff(db, {
    staffId: staffA,
    employment: "full_time",
    slackUserId: null,
    telegramUserId: telegramUser,
    displayName: "Alice",
  });
  const sent: string[] = [];
  const sender: TelegramSender = {
    async sendMessage(_chatId, text) {
      sent.push(text);
    },
  };
  const handled = await handleTelegramUpdate(
    db,
    telegramGrants,
    {
      update_id: 1,
      message: {
        message_id: 10,
        text: "/split 12.50 kopi",
        chat: { id: Number(telegramChannel), type: "group" },
        from: { id: Number(telegramUser) },
      },
    },
    sender,
  );
  expect(handled.handled).toBe(true);
  expect(sent.join("\n")).toMatch(/pending confirm/i);
  const idMatch = sent.join("\n").match(/id=([0-9a-f-]{36})/i);
  expect(idMatch).toBeTruthy();

  sent.length = 0;
  await handleTelegramUpdate(
    db,
    telegramGrants,
    {
      update_id: 2,
      message: {
        message_id: 11,
        text: `/confirm_expense ${idMatch![1]}`,
        chat: { id: Number(telegramChannel), type: "group" },
        from: { id: Number(telegramUser) },
      },
    },
    sender,
  );
  expect(sent.join("\n")).toMatch(/confirmed/i);
});

test("telegram drops non-allowlisted chat", async () => {
  const db = await freshDb();
  const sent: string[] = [];
  const sender: TelegramSender = {
    async sendMessage(_c, text) {
      sent.push(text);
    },
  };
  const handled = await handleTelegramUpdate(
    db,
    telegramGrants,
    {
      update_id: 3,
      message: {
        message_id: 1,
        text: "/tally",
        chat: { id: 999999, type: "group" },
        from: { id: Number(telegramUser) },
      },
    },
    sender,
  );
  expect(handled.handled).toBe(false);
  expect(sent.length).toBe(0);
});
