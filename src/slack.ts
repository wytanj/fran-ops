import { App, ExpressReceiver, LogLevel } from "@slack/bolt";
import { CHANNEL_ALLOWLIST, type ChannelGrant } from "./allowlist.ts";
import { pgDb, type Db } from "./db.ts";
import { resolvedTellCard } from "./cards.ts";
import { handleAppMention, handleCardAction, handleChannelMessage, handleFranCommand, handleReaction } from "./handlers.ts";
import { publishPending, type SlackPoster } from "./publish.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSlackMessage(
  event: unknown,
  body: unknown,
): {
  eventId: string;
  channelId: string;
  slackUserId: string | null;
  text: string;
  bot: boolean;
} | null {
  if (!isRecord(event) || !isRecord(body)) return null;
  if (typeof event.channel !== "string" || typeof event.text !== "string") return null;
  if (typeof body.event_id !== "string" || body.event_id.trim() === "") return null;
  return {
    eventId: body.event_id,
    channelId: event.channel,
    slackUserId: typeof event.user === "string" ? event.user : null,
    text: event.text,
    bot: typeof event.bot_id === "string" || typeof event.subtype === "string",
  };
}

export function parseSlackReaction(event: unknown): {
  slackUserId: string;
  emoji: string;
  channelId: string;
  messageRef: string;
} | null {
  if (!isRecord(event) || !isRecord(event.item)) return null;
  const item = event.item;
  if (item.type !== "message") return null;
  if (typeof event.user !== "string" || typeof event.reaction !== "string") return null;
  if (typeof item.channel !== "string" || typeof item.ts !== "string") return null;
  return {
    slackUserId: event.user,
    emoji: event.reaction,
    channelId: item.channel,
    messageRef: item.ts,
  };
}

export function parseSlackCardAction(
  action: unknown,
  body: unknown,
): { actionId: string; taskId: string; slackUserId: string; actionTs: string } | null {
  if (!isRecord(action) || !isRecord(body) || !isRecord(body.user)) return null;
  if (typeof action.action_id !== "string" || typeof action.value !== "string" || typeof action.action_ts !== "string") {
    return null;
  }
  if (typeof body.user.id !== "string") return null;
  return {
    actionId: action.action_id,
    taskId: action.value,
    slackUserId: body.user.id,
    actionTs: action.action_ts,
  };
}

export function createSlackApp(opts: {
  db: Db;
  botToken: string;
  signingSecret: string;
  grants?: readonly ChannelGrant[];
  botId?: string;
  botUserId?: string;
  verifyToken?: boolean;
}): App {
  const grants = opts.grants ?? CHANNEL_ALLOWLIST;
  const receiver = new ExpressReceiver({
    signingSecret: opts.signingSecret,
    endpoints: "/slack/events",
    processBeforeResponse: true,
  });
  const app = new App({
    token: opts.botToken,
    botId: opts.botId,
    botUserId: opts.botUserId,
    receiver,
    tokenVerificationEnabled: opts.verifyToken ?? false,
    logLevel: LogLevel.ERROR,
    socketMode: false,
  });

  app.event("message", async ({ event, body }) => {
    const parsed = parseSlackMessage(event, body);
    if (parsed === null) return;
    await handleChannelMessage(opts.db, grants, parsed);
  });

  app.event("app_mention", async ({ event, body, say }) => {
    if (!isRecord(event) || !isRecord(body)) return;
    if (typeof event.channel !== "string" || typeof event.user !== "string" || typeof event.text !== "string") return;
    if (typeof body.event_id !== "string") return;
    const result = await handleAppMention(opts.db, grants, {
      eventId: body.event_id,
      channelId: event.channel,
      slackUserId: event.user,
      text: event.text,
    });
    if (!result.ok) {
      await say({ text: result.reply, thread_ts: typeof event.ts === "string" ? event.ts : undefined });
    }
  });

  app.event("reaction_added", async ({ event }) => {
    const parsed = parseSlackReaction(event);
    if (parsed === null) return;
    await handleReaction(opts.db, grants, parsed);
  });

  app.command("/bird", async ({ command, ack }) => {
    const result = await handleFranCommand(opts.db, grants, {
      text: command.text,
      slackUserId: command.user_id,
      channelId: command.channel_id,
      triggerId: command.trigger_id,
    });
    await ack({ response_type: "ephemeral", text: result.reply });
  });

  app.action(/^card\./, async ({ action, body, ack, respond }) => {
    const parsed = parseSlackCardAction(action, body);
    await ack();
    if (parsed === null) return;
    const result = await handleCardAction(opts.db, parsed);
    if (!result.recorded) {
      await respond({ response_type: "ephemeral", text: "Could not record that decision (not linked or bad payload)." });
      return;
    }
    const decision = parsed.actionId === "card.approve" ? "approve" : "send_back";
    const priorText =
      isRecord(body) && isRecord(body.message) && typeof body.message.text === "string"
        ? body.message.text
        : "Franbird tell";
    const card = resolvedTellCard({ body: priorText, decision });
    await respond({
      replace_original: true,
      text: card.text,
      blocks: card.blocks,
    });
  });

  return app;
}

export function webPoster(client: App["client"]): SlackPoster {
  return {
    async post(message) {
      const result = await client.chat.postMessage({
        channel: message.channel,
        text: message.text,
        blocks: message.blocks,
      });
      if (typeof result.ts !== "string" || result.ts.length === 0) {
        throw new Error("Slack did not return a message ts");
      }
      return { ts: result.ts };
    },
  };
}

export async function startFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const botToken = env.SLACK_BOT_TOKEN ?? "";
  const signingSecret = env.SLACK_SIGNING_SECRET ?? "";
  const databaseUrl = env.DATABASE_URL ?? "";
  if (botToken === "" || signingSecret === "" || databaseUrl === "") {
    throw new Error("SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, and DATABASE_URL are required");
  }
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be a positive integer");
  const db = pgDb(databaseUrl);
  const app = createSlackApp({ db, botToken, signingSecret, verifyToken: true });
  const poster = webPoster(app.client);
  const timer = setInterval(() => {
    void publishPending(db, poster).catch((error: unknown) => {
      app.logger.error(error);
    });
  }, 5000);
  timer.unref();
  await app.start(port);
}

if (import.meta.main) {
  await startFromEnv();
}
