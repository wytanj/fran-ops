/**
 * Slack thread rope-in helpers.
 * @Franbird / /bird in a thread → load context via conversations.replies; reply with thread_ts.
 */

export type ThreadMessage = {
  ts: string;
  userId: string | null;
  text: string;
  bot: boolean;
};

export type ThreadContext = {
  channelId: string;
  threadTs: string;
  messages: ThreadMessage[];
};

export type SlackRepliesClient = {
  conversations: {
    replies: (args: {
      channel: string;
      ts: string;
      limit?: number;
      inclusive?: boolean;
    }) => Promise<{
      ok?: boolean;
      messages?: Array<Record<string, unknown>>;
      error?: string;
    }>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pickThreadTs(eventOrCommand: unknown): string | null {
  if (!isRecord(eventOrCommand)) return null;
  if (typeof eventOrCommand.thread_ts === "string" && eventOrCommand.thread_ts.trim() !== "") {
    return eventOrCommand.thread_ts;
  }
  return null;
}

/**
 * Parent thread_ts for replies: prefer existing thread_ts; else the message ts
 * (so a top-level mention starts a thread).
 */
export function replyThreadTs(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  if (typeof event.thread_ts === "string" && event.thread_ts.trim() !== "") return event.thread_ts;
  if (typeof event.ts === "string" && event.ts.trim() !== "") return event.ts;
  return undefined;
}

function mapReplyMessage(raw: Record<string, unknown>): ThreadMessage | null {
  if (typeof raw.ts !== "string" || typeof raw.text !== "string") return null;
  return {
    ts: raw.ts,
    userId: typeof raw.user === "string" ? raw.user : null,
    text: raw.text,
    bot: typeof raw.bot_id === "string" || typeof raw.subtype === "string",
  };
}

/**
 * Load thread messages via conversations.replies (allowlisted callers only).
 * Caps at `limit` (default 50). Returns empty messages on API failure (caller may still reply).
 */
export async function loadThreadContext(
  client: SlackRepliesClient,
  input: { channelId: string; threadTs: string; limit?: number },
): Promise<ThreadContext> {
  const limit = input.limit ?? 50;
  try {
    const res = await client.conversations.replies({
      channel: input.channelId,
      ts: input.threadTs,
      limit,
      inclusive: true,
    });
    const raw = Array.isArray(res.messages) ? res.messages : [];
    const messages: ThreadMessage[] = [];
    for (const item of raw) {
      if (!isRecord(item)) continue;
      const mapped = mapReplyMessage(item);
      if (mapped !== null) messages.push(mapped);
    }
    return { channelId: input.channelId, threadTs: input.threadTs, messages };
  } catch {
    return { channelId: input.channelId, threadTs: input.threadTs, messages: [] };
  }
}

export function threadTextsForRouting(ctx: ThreadContext | null | undefined): string[] {
  if (ctx === null || ctx === undefined) return [];
  return ctx.messages.filter((m) => !m.bot && m.text.trim() !== "").map((m) => m.text);
}

export function summarizeThreadContext(ctx: ThreadContext, maxLines = 8): string {
  if (ctx.messages.length === 0) return "(no thread messages loaded)";
  const lines = ctx.messages.slice(-maxLines).map((m) => {
    const who = m.bot ? "bot" : (m.userId ?? "unknown");
    const text = m.text.length > 200 ? `${m.text.slice(0, 197)}...` : m.text;
    return `<@${who}>: ${text}`;
  });
  return lines.join("\n");
}
