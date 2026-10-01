import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import { expect, test } from "bun:test";
import { linkStaff } from "../src/bus.ts";
import { publishPending } from "../src/publish.ts";
import { createSlackApp } from "../src/slack.ts";
import { freshDb } from "./harness.ts";
import { slackChannel, slackGrants, slackUser, staffA, telegramUser } from "./fixtures.ts";

const secret = "test-signing-secret";

function sign(timestamp: string, body: string): string {
  return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Slack receiver has no port");
  return address.port;
}

test("Bolt accepts a signed /bird command, a channel message, and a done reaction", async () => {
  const db = await freshDb();
  await linkStaff(db, {
    staffId: staffA,
    employment: "full_time",
    slackUserId: slackUser,
    telegramUserId: telegramUser,
  });
  const app = createSlackApp({
    db,
    botToken: "xoxb-test",
    botId: "B0TEST",
    botUserId: "U0BOT",
    signingSecret: secret,
    grants: slackGrants,
  });
  const server = await app.start(0);
  try {
    const port = portOf(server);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const unsigned = await fetch(`http://127.0.0.1:${port}/slack/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(unsigned.status).toBe(401);

    const commandBody = new URLSearchParams({
      command: "/bird",
      text: "shift_open",
      user_id: slackUser,
      channel_id: slackChannel,
      trigger_id: "trig-http",
      team_id: "T0TEST",
    }).toString();
    const commandRes = await fetch(`http://127.0.0.1:${port}/slack/events`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": sign(timestamp, commandBody),
      },
      body: commandBody,
    });
    expect(commandRes.status).toBe(200);
    expect(await commandRes.text()).toContain("Opened Open shift.");

    const freeBody = new URLSearchParams({
      command: "/bird",
      text: "shift_open buy milk",
      user_id: slackUser,
      channel_id: slackChannel,
      trigger_id: "trig-http-free",
      team_id: "T0TEST",
    }).toString();
    const freeRes = await fetch(`http://127.0.0.1:${port}/slack/events`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": sign(timestamp, freeBody),
      },
      body: freeBody,
    });
    expect(freeRes.status).toBe(200);
    expect(await freeRes.text()).toContain("Templates do not take free text.");

    const published = await publishPending(db, {
      async post() {
        return { ts: "1700000000.0001" };
      },
    });
    expect(published.published).toBe(1);

    const message = JSON.stringify({
      type: "event_callback",
      token: "test",
      team_id: "T0TEST",
      api_app_id: "A0TEST",
      event_id: "EvHTTP1",
      event_time: Number(timestamp),
      event: {
        type: "message",
        channel: slackChannel,
        user: slackUser,
        text: "on the floor",
        ts: "1700000000.2222",
      },
    });
    const messageRes = await fetch(`http://127.0.0.1:${port}/slack/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": sign(timestamp, message),
      },
      body: message,
    });
    expect(messageRes.status).toBe(200);

    const reaction = JSON.stringify({
      type: "event_callback",
      token: "test",
      team_id: "T0TEST",
      api_app_id: "A0TEST",
      event_id: "EvHTTP2",
      event_time: Number(timestamp),
      event: {
        type: "reaction_added",
        user: slackUser,
        reaction: "white_check_mark",
        item: { type: "message", channel: slackChannel, ts: "1700000000.0001" },
        event_ts: "1700000000.0002",
      },
    });
    const reactionRes = await fetch(`http://127.0.0.1:${port}/slack/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": sign(timestamp, reaction),
      },
      body: reaction,
    });
    expect(reactionRes.status).toBe(200);

    const tasks = await db.query<{ status: string; n: string }>(
      `select status, (select count(*)::text from events where event_type = 'channel.message') as n from tasks`,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("done");
    expect(tasks[0]?.n).toBe("1");
  } finally {
    await app.stop();
  }
});
