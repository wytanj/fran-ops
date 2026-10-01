import { expect, test } from "bun:test";
import { findGrant } from "../src/allowlist.ts";
import { linkStaff, openTask } from "../src/bus.ts";
import { handleCardAction, handleChannelMessage, handleFranCommand, handleReaction } from "../src/handlers.ts";
import { publishPending, type SlackPost, type SlackPoster } from "../src/publish.ts";
import type { Db } from "../src/db.ts";
import { freshDb } from "./harness.ts";
import { slackChannel, slackGrants, slackUser, staffA, staffB, telegramChannel, telegramGrants, telegramUser } from "./fixtures.ts";

function recordingPoster(): SlackPoster & { posts: SlackPost[] } {
  const posts: SlackPost[] = [];
  return {
    posts,
    async post(message) {
      posts.push(message);
      return { ts: `1700000000.000${posts.length}` };
    },
  };
}

async function count(db: Db, table: "events" | "tasks" | "stamps" | "outbox"): Promise<number> {
  const rows = await db.query<{ n: string | number }>(`select count(*)::text as n from ${table}`);
  return Number(rows[0]?.n ?? 0);
}

async function linkedDb(): Promise<Db> {
  const db = await freshDb();
  await linkStaff(db, {
    staffId: staffA,
    employment: "part_time",
    slackUserId: slackUser,
    telegramUserId: telegramUser,
  });
  return db;
}

test("template command opens one task and one draft card, and a retry does not duplicate it", async () => {
  const db = await linkedDb();
  const first = await handleFranCommand(db, slackGrants, {
    text: "shift_open",
    slackUserId: slackUser,
    channelId: slackChannel,
    triggerId: "trig-1",
  });
  expect(first.reply).toBe("Opened Open shift.");
  const second = await handleFranCommand(db, slackGrants, {
    text: "shift_open",
    slackUserId: slackUser,
    channelId: slackChannel,
    triggerId: "trig-1",
  });
  expect(second.reply).toBe("Opened Open shift.");
  expect(await count(db, "tasks")).toBe(1);
  expect(await count(db, "outbox")).toBe(1);

  const rows = await db.query<{ destination: string; card_template: string; title: string; event_type: string }>(
    `select o.destination, o.card_template, t.title, e.event_type
     from outbox o
     join events e on e.id = o.event_id
     join tasks t on t.opened_event_id = e.id`,
  );
  expect(rows[0]).toEqual({
    destination: "slack",
    card_template: "draft_for_approve",
    title: "Open shift",
    event_type: "task.opened",
  });

  const poster = recordingPoster();
  const published = await publishPending(db, poster);
  expect(published).toEqual({ published: 1, failed: 0 });
  expect(poster.posts[0]?.text).toBe("Open shift");
  expect(JSON.stringify(poster.posts[0]?.blocks)).toContain("card.approve");
  const again = await publishPending(db, poster);
  expect(again.published).toBe(0);

  const ref = await db.query<{ message_ref: string }>(`select message_ref from tasks`);
  const messageRef = ref[0]?.message_ref;
  expect(messageRef).toBe("1700000000.0001");
  if (messageRef === undefined) throw new Error("missing message ref");

  const done = await handleReaction(db, slackGrants, {
    slackUserId: slackUser,
    emoji: "white_check_mark",
    channelId: slackChannel,
    messageRef,
  });
  expect(done.applied).toBe(true);
  const replay = await handleReaction(db, slackGrants, {
    slackUserId: slackUser,
    emoji: "white_check_mark",
    channelId: slackChannel,
    messageRef,
  });
  expect(replay.applied).toBe(true);
  expect(await count(db, "stamps")).toBe(1);
  const status = await db.query<{ status: string }>(`select status from tasks`);
  expect(status[0]?.status).toBe("done");
});

test("free text and unknown templates do not create tasks", async () => {
  const db = await linkedDb();
  const free = await handleFranCommand(db, slackGrants, {
    text: "shift_open buy milk",
    slackUserId: slackUser,
    channelId: slackChannel,
    triggerId: "trig-free",
  });
  const unknown = await handleFranCommand(db, slackGrants, {
    text: "buy milk",
    slackUserId: slackUser,
    channelId: slackChannel,
    triggerId: "trig-unknown",
  });
  expect(free.reply).toContain("Templates do not take free text.");
  expect(unknown.reply).toContain("shift_open");
  expect(await count(db, "tasks")).toBe(0);
});

test("messages land only for allowlisted channels, and unmapped reactions do not stamp", async () => {
  const db = await linkedDb();
  const blocked = await handleChannelMessage(db, slackGrants, {
    eventId: "Ev-off",
    channelId: "C0OTHER1",
    slackUserId: slackUser,
    text: "hello",
    bot: false,
  });
  expect(blocked.stored).toBe(false);
  const stored = await handleChannelMessage(db, slackGrants, {
    eventId: "Ev-on",
    channelId: slackChannel,
    slackUserId: slackUser,
    text: "hello",
    bot: false,
  });
  const duplicate = await handleChannelMessage(db, slackGrants, {
    eventId: "Ev-on",
    channelId: slackChannel,
    slackUserId: slackUser,
    text: "hello",
    bot: false,
  });
  expect(stored.stored).toBe(true);
  expect(duplicate.stored).toBe(true);
  expect(await count(db, "events")).toBe(1);

  const bot = await handleChannelMessage(db, slackGrants, {
    eventId: "Ev-bot",
    channelId: slackChannel,
    slackUserId: null,
    text: "bot",
    bot: true,
  });
  expect(bot.stored).toBe(false);

  await db.query(
    `insert into channel_allowlist (surface, channel_id, name) values ('slack', 'C0DBONLY', 'rogue')`,
  );
  const rogue = await handleChannelMessage(db, slackGrants, {
    eventId: "Ev-rogue",
    channelId: "C0DBONLY",
    slackUserId: slackUser,
    text: "smuggled",
    bot: false,
  });
  expect(rogue.stored).toBe(false);
  expect(findGrant([], "slack", slackChannel)).toBeNull();

  const ignored = await handleReaction(db, slackGrants, {
    slackUserId: slackUser,
    emoji: "thumbsup",
    channelId: slackChannel,
    messageRef: "1700000000.9999",
  });
  expect(ignored.applied).toBe(false);
  expect(await count(db, "stamps")).toBe(0);
});

test("telegram uses the same task.opened event and the Slack publisher leaves that row pending", async () => {
  const db = await linkedDb();
  const opened = await openTask(db, {
    grants: telegramGrants,
    templateKey: "incident",
    staffId: staffA,
    surface: "telegram",
    channelId: telegramChannel,
    idempotencyKey: "tg-incident-1",
  });
  expect(opened.ok).toBe(true);
  const result = await publishPending(db, recordingPoster());
  expect(result).toEqual({ published: 0, failed: 0 });
  const rows = await db.query<{ destination: string; status: string; event_type: string }>(
    `select o.destination, o.status, e.event_type
     from outbox o join events e on e.id = o.event_id`,
  );
  expect(rows[0]).toEqual({
    destination: "telegram",
    status: "pending",
    event_type: "task.opened",
  });
});

test("a failed Slack post stays failed, and a stale publishing row is sent once", async () => {
  const db = await linkedDb();
  const opened = await openTask(db, {
    grants: slackGrants,
    templateKey: "hand_off",
    staffId: staffA,
    surface: "slack",
    channelId: slackChannel,
    idempotencyKey: "slack-hand-1",
  });
  if (!opened.ok) throw new Error(opened.reason);
  const failing: SlackPoster = {
    async post() {
      throw new Error("slack down");
    },
  };
  const failed = await publishPending(db, failing);
  expect(failed).toEqual({ published: 0, failed: 1 });
  const retry = await publishPending(db, recordingPoster());
  expect(retry.published).toBe(0);
  const failedRow = await db.query<{ status: string; last_error: string }>(
    `select status, last_error from outbox where id = $1`,
    [opened.value.outboxId],
  );
  expect(failedRow[0]?.status).toBe("failed");
  expect(failedRow[0]?.last_error).toBe("slack down");

  await linkStaff(db, {
    staffId: staffB,
    employment: "full_time",
    slackUserId: null,
    telegramUserId: null,
  });
  const second = await openTask(db, {
    grants: slackGrants,
    templateKey: "shift_close",
    staffId: staffB,
    surface: "slack",
    channelId: slackChannel,
    idempotencyKey: "slack-close-1",
  });
  if (!second.ok) throw new Error(second.reason);
  await db.query(
    `update outbox
     set status = 'publishing', claimed_at = now() - interval '2 hours'
     where id = $1`,
    [second.value.outboxId],
  );
  const recovered = await publishPending(db, recordingPoster());
  expect(recovered).toEqual({ published: 1, failed: 0 });
  const status = await db.query<{ status: string; message_ref: string }>(
    `select o.status, t.message_ref
     from outbox o join tasks t on t.id = $1
     where o.id = $2`,
    [second.value.taskId, second.value.outboxId],
  );
  expect(status[0]?.status).toBe("published");
  expect(status[0]?.message_ref).toBe("1700000000.0001");
});

test("approve and send back write bus events for the same task", async () => {
  const db = await linkedDb();
  const opened = await openTask(db, {
    grants: slackGrants,
    templateKey: "shift_open",
    staffId: staffA,
    surface: "slack",
    channelId: slackChannel,
    idempotencyKey: "slack-open-card",
  });
  if (!opened.ok) throw new Error(opened.reason);
  const approved = await handleCardAction(db, {
    actionId: "card.approve",
    taskId: opened.value.taskId,
    slackUserId: slackUser,
    actionTs: "1700000001.0001",
  });
  const approvedAgain = await handleCardAction(db, {
    actionId: "card.approve",
    taskId: opened.value.taskId,
    slackUserId: slackUser,
    actionTs: "1700000001.0001",
  });
  const sentBack = await handleCardAction(db, {
    actionId: "card.send_back",
    taskId: opened.value.taskId,
    slackUserId: slackUser,
    actionTs: "1700000001.0002",
  });
  expect(approved.recorded).toBe(true);
  expect(approvedAgain.recorded).toBe(true);
  expect(sentBack.recorded).toBe(true);
  const types = await db.query<{ event_type: string }>(
    `select event_type from events where event_type in ('card.approved', 'card.sent_back') order by event_type`,
  );
  expect(types.map((row) => row.event_type)).toEqual(["card.approved", "card.sent_back"]);
});

test("the same person is returned from Slack and from Telegram", async () => {
  const db = await linkedDb();
  const fromSlack = await db.query<{ staff_id: string }>(
    `select staff_id from staff_identities where slack_user_id = $1`,
    [slackUser],
  );
  const fromTelegram = await db.query<{ staff_id: string }>(
    `select staff_id from staff_identities where telegram_user_id = $1`,
    [telegramUser],
  );
  expect(fromSlack[0]?.staff_id).toBe(staffA);
  expect(fromTelegram[0]?.staff_id).toBe(staffA);
  await expect(
    linkStaff(db, {
      staffId: staffB,
      employment: "full_time",
      slackUserId: slackUser,
      telegramUserId: null,
    }),
  ).rejects.toThrow();
});
