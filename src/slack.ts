import { App, ExpressReceiver, LogLevel } from "@slack/bolt";
import { CHANNEL_ALLOWLIST, loadChannelAllowlist, type ChannelGrant } from "./allowlist.ts";
import { pgDb, type Db } from "./db.ts";
import { resolvedTellCard } from "./cards.ts";
import { handleAppMention, handleCardAction, handleChannelMessage, handleFranCommand, handleReaction } from "./handlers.ts";
import { handleBillCardAction } from "./bill_handlers.ts";
import { handleHardwareChannelFile, handleIssueCardAction, type HardwareSlackFile } from "./issue_handlers.ts";
import { readIssueApproverSlackUserId } from "./issue_domain.ts";
import { mountTelegramWebhook } from "./telegram.ts";
import { publishPending, type SlackPoster } from "./publish.ts";
import { loadThreadContext, pickThreadTs, replyThreadTs, type SlackRepliesClient } from "./thread.ts";

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

const SKIP_MESSAGE_SUBTYPES = new Set([
  "bot_message",
  "message_changed",
  "message_deleted",
  "message_replied",
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
  "tombstone",
]);

const IMAGE_FILETYPES = new Set(["jpg", "jpeg", "png", "gif", "heic", "heif", "webp", "bmp"]);

function isSlackImage(file: Record<string, unknown>): boolean {
  if (typeof file.mimetype === "string" && file.mimetype.toLowerCase().startsWith("image/")) return true;
  return typeof file.filetype === "string" && IMAGE_FILETYPES.has(file.filetype.toLowerCase());
}

function firstHttpUrl(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
  }
  return null;
}

export function parseHardwareSlackFile(event: unknown, body: unknown): HardwareSlackFile | null {
  if (!isRecord(event) || !isRecord(body)) return null;
  if (typeof event.bot_id === "string") return null;
  if (typeof event.subtype === "string" && SKIP_MESSAGE_SUBTYPES.has(event.subtype)) return null;
  if (typeof event.channel !== "string" || typeof event.user !== "string" || typeof event.ts !== "string") {
    return null;
  }
  if (typeof body.event_id !== "string" || body.event_id.trim() === "") return null;
  if (!Array.isArray(event.files)) return null;
  const photos: HardwareSlackFile["photos"] = [];
  for (const file of event.files) {
    if (!isRecord(file) || typeof file.id !== "string" || file.id.trim() === "") continue;
    if (!isSlackImage(file)) continue;
    photos.push({
      slackFileId: file.id.trim(),
      url: firstHttpUrl([file.url_private, file.permalink]),
    });
  }
  if (photos.length === 0) return null;
  const threadTs =
    typeof event.thread_ts === "string" && event.thread_ts.trim() !== "" ? event.thread_ts : event.ts;
  return {
    eventId: body.event_id,
    channelId: event.channel,
    slackUserId: event.user,
    caption: typeof event.text === "string" ? event.text : "",
    threadTs,
    photos,
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

async function maybeLoadThread(
  client: SlackRepliesClient,
  channelId: string,
  source: unknown,
): Promise<Awaited<ReturnType<typeof loadThreadContext>> | null> {
  const threadTs = pickThreadTs(source);
  if (threadTs === null) return null;
  return loadThreadContext(client, { channelId, threadTs });
}

export function createSlackApp(opts: {
  db: Db;
  botToken: string;
  signingSecret: string;
  grants?: readonly ChannelGrant[];
  botId?: string;
  botUserId?: string;
  verifyToken?: boolean;
  env?: NodeJS.ProcessEnv;
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
  mountTelegramWebhook(receiver.app, { db: opts.db, grants, env: opts.env ?? process.env });

  app.event("message", async ({ event, body }) => {
    const hardware = parseHardwareSlackFile(event, body);
    if (hardware !== null) {
      await handleHardwareChannelFile(
        opts.db,
        grants,
        hardware,
        readIssueApproverSlackUserId(opts.env ?? process.env),
      );
    }
    const parsed = parseSlackMessage(event, body);
    if (parsed === null) return;
    await handleChannelMessage(opts.db, grants, parsed);
  });

  app.event("app_mention", async ({ event, body, say, client }) => {
    if (!isRecord(event) || !isRecord(body)) return;
    if (typeof event.channel !== "string" || typeof event.user !== "string" || typeof event.text !== "string") return;
    if (typeof body.event_id !== "string") return;
    const thread = await maybeLoadThread(client as SlackRepliesClient, event.channel, event);
    const result = await handleAppMention(opts.db, grants, {
      eventId: body.event_id,
      channelId: event.channel,
      slackUserId: event.user,
      text: event.text,
      thread,
    });
    const threadTs = replyThreadTs(event);
    await say({ text: result.reply, thread_ts: threadTs });
    if (result.billCard !== undefined) {
      await say({
        text: result.billCard.text,
        blocks: result.billCard.blocks,
        thread_ts: result.billThreadRef ?? threadTs,
      });
    }
  });

  app.event("reaction_added", async ({ event }) => {
    const parsed = parseSlackReaction(event);
    if (parsed === null) return;
    await handleReaction(opts.db, grants, parsed);
  });

  app.command("/bird", async ({ command, ack, client }) => {
    const thread = await maybeLoadThread(client as SlackRepliesClient, command.channel_id, command);
    const result = await handleFranCommand(opts.db, grants, {
      text: command.text,
      slackUserId: command.user_id,
      channelId: command.channel_id,
      triggerId: command.trigger_id,
      thread,
    });
    // Slash ack is ephemeral; when invoked in a thread Slack still scopes it there.
    await ack({ response_type: "ephemeral", text: result.reply });
    if (result.billCard !== undefined) {
      const threadTs = result.billThreadRef ?? thread?.threadTs ?? undefined;
      await client.chat.postMessage({
        channel: command.channel_id,
        text: result.billCard.text,
        blocks: result.billCard.blocks,
        thread_ts: threadTs,
      });
    }
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

  app.action(/^issue\./, async ({ action, body, ack, respond }) => {
    const parsed = parseSlackCardAction(action, body);
    await ack();
    if (parsed === null) return;
    const result = await handleIssueCardAction(opts.db, {
      actionId: parsed.actionId,
      issueId: parsed.taskId,
      slackUserId: parsed.slackUserId,
      actionTs: parsed.actionTs,
    });
    if (!result.recorded || result.card === undefined) {
      await respond({
        response_type: "ephemeral",
        text: result.reply ?? "Could not record that decision.",
      });
      return;
    }
    await respond({
      replace_original: true,
      text: result.card.text,
      blocks: result.card.blocks,
    });
  });

  app.action(/^bill\./, async ({ action, body, ack, respond }) => {
    const parsed = parseSlackCardAction(action, body);
    await ack();
    if (parsed === null) return;
    const result = await handleBillCardAction(opts.db, {
      actionId: parsed.actionId,
      expenseId: parsed.taskId,
      slackUserId: parsed.slackUserId,
      actionTs: parsed.actionTs,
    });
    if (!result.recorded) {
      await respond({
        response_type: "ephemeral",
        text: result.reply ?? "Could not record that bill action.",
      });
      return;
    }
    if (result.card !== undefined) {
      await respond({
        replace_original: true,
        text: result.card.text,
        blocks: result.card.blocks,
      });
      return;
    }
    if (result.reply !== undefined) {
      await respond({ response_type: "ephemeral", text: result.reply });
    }
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
        ...(message.threadTs !== undefined ? { thread_ts: message.threadTs } : {}),
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
  const grants = loadChannelAllowlist(env);
  const app = createSlackApp({ db, botToken, signingSecret, grants, verifyToken: true, env });
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
