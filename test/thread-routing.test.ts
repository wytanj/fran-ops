import { expect, test } from "bun:test";
import { linkStaff } from "../src/bus.ts";
import { handleAppMention, handleFranCommand } from "../src/handlers.ts";
import type { ThreadContext } from "../src/thread.ts";
import { freshDb } from "./harness.ts";
import { slackChannel, slackGrants, slackUser, staffA, telegramUser } from "./fixtures.ts";

const thread: ThreadContext = {
  channelId: slackChannel,
  threadTs: "1700000000.1000",
  messages: [
    { ts: "1700000000.1000", userId: slackUser, text: "need the roster tonight", bot: false },
    { ts: "1700000000.1001", userId: "U0BOT", text: "ok", bot: true },
  ],
};

test("handleFranCommand routes staff intent stubs with thread context", async () => {
  const db = await freshDb();
  await linkStaff(db, {
    staffId: staffA,
    employment: "full_time",
    slackUserId: slackUser,
    telegramUserId: telegramUser,
    displayName: "Jeremy",
  });
  const routed = await handleFranCommand(db, slackGrants, {
    text: "can you help with this?",
    slackUserId: slackUser,
    channelId: slackChannel,
    triggerId: "trig-route",
    thread,
  });
  expect(routed.reply).toContain("hrm_roster");
  expect(routed.reply).toContain("hrm.roster");
  expect(routed.reply).toContain("stubbed");

  const help = await handleFranCommand(db, slackGrants, {
    text: "help",
    slackUserId: slackUser,
    channelId: slackChannel,
    triggerId: "trig-help",
  });
  expect(help.reply).toContain("conversations.replies");
});

test("handleAppMention in thread uses routing when not a tell", async () => {
  const db = await freshDb();
  await linkStaff(db, {
    staffId: staffA,
    employment: "full_time",
    slackUserId: slackUser,
    telegramUserId: telegramUser,
  });
  const result = await handleAppMention(db, slackGrants, {
    eventId: "EvThread1",
    channelId: slackChannel,
    slackUserId: slackUser,
    text: `<@U0BOT> what is on the roster?`,
    thread,
  });
  expect(result.ok).toBe(false);
  expect(result.reply).toContain("hrm_roster");
});
