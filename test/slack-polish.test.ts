import { expect, test } from "bun:test";
import { extractCardBodyFromMessage, franbirdTellCard, resolvedTellCard } from "../src/cards.ts";
import { birdCommandHelp, parseFranbirdTell, parseSlackUserId } from "../src/domain.ts";
import { handleFranCommand } from "../src/handlers.ts";
import { linkStaff } from "../src/bus.ts";
import { freshDb } from "./harness.ts";
import { slackChannel, slackGrants, slackUser, staffA, telegramUser } from "./fixtures.ts";

const assigneeSlack = parseSlackUserId("U0STAFF2");
if (assigneeSlack === null) throw new Error("assignee");

test("parseFranbirdTell accepts bare Slack user id after tell", () => {
  const parsed = parseFranbirdTell("tell U0STAFF2 cover open briefing=required");
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.assigneeSlackUserId).toBe(assigneeSlack);
  expect(parsed.value.body).toBe("cover open");
});

test("birdCommandHelp and /bird help", async () => {
  expect(birdCommandHelp()).toContain("/bird");
  const db = await freshDb();
  await linkStaff(db, {
    staffId: staffA,
    employment: "full_time",
    slackUserId: slackUser,
    telegramUserId: telegramUser,
  });
  const help = await handleFranCommand(db, slackGrants, {
    text: "help",
    slackUserId: slackUser,
    channelId: slackChannel,
    triggerId: "trig-help",
  });
  expect(help.reply).toContain("Templates:");
  const empty = await handleFranCommand(db, slackGrants, {
    text: "  ",
    slackUserId: slackUser,
    channelId: slackChannel,
    triggerId: "trig-empty",
  });
  expect(empty.reply).toContain("Franbird");
});

test("extractCardBodyFromMessage prefers section mrkdwn for replace_original", () => {
  const card = franbirdTellCard({
    taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    body: "cover open",
    openerLabel: "Jeremy",
    assigneeLabel: "Alice",
    briefing: "required",
  });
  const body = extractCardBodyFromMessage({ text: card.text, blocks: card.blocks });
  expect(body).toContain("cover open");
  expect(body).toContain("Alice");
  expect(body).not.toBe(card.text);

  const resolved = resolvedTellCard({ body, decision: "approve" });
  expect(resolved.blocks.some((b) => b.type === "actions")).toBe(false);
  expect(JSON.stringify(resolved.blocks)).toContain("Approved");
  expect(JSON.stringify(franbirdTellCard({
    taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    body: "x",
    openerLabel: "a",
    assigneeLabel: "b",
    briefing: "optional",
  }).blocks)).toContain("card.approve");
});
