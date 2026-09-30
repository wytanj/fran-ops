import type { Db } from "./db.ts";

export type SlackPost = {
  channel: string;
  text: string;
  blocks: unknown[];
};

export type SlackPoster = {
  post(message: SlackPost): Promise<{ ts: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPayload(value: unknown): SlackPost & { taskId: string } {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  if (!isRecord(raw)) throw new Error("outbox payload is not an object");
  const { channelId, taskId, text, blocks } = raw;
  if (typeof channelId !== "string" || typeof taskId !== "string" || typeof text !== "string" || !Array.isArray(blocks)) {
    throw new Error("outbox payload is missing card fields");
  }
  return { channel: channelId, text, blocks, taskId };
}

export async function publishPending(
  db: Db,
  poster: SlackPoster,
  opts: { limit?: number; staleSeconds?: number } = {},
): Promise<{ published: number; failed: number }> {
  const limit = opts.limit ?? 10;
  const staleSeconds = opts.staleSeconds ?? 300;
  const claimed = await db.transaction(async (query) => {
    await query(
      `update outbox
       set status = 'pending', claimed_at = null
       where status = 'publishing'
         and published_at is null
         and claimed_at < now() - make_interval(secs => $1)`,
      [staleSeconds],
    );
    return query<{ id: string; payload: unknown }>(
      `update outbox
       set status = 'publishing', attempt_count = attempt_count + 1, claimed_at = now()
       where id in (
         select id from outbox
         where status = 'pending' and destination = 'slack' and available_at <= now()
         order by created_at
         limit $1
         for update skip locked
       )
       returning id, payload`,
      [limit],
    );
  });

  let published = 0;
  let failed = 0;
  for (const row of claimed) {
    try {
      const card = readPayload(row.payload);
      const sent = await poster.post({ channel: card.channel, text: card.text, blocks: card.blocks });
      await db.transaction(async (query) => {
        await query(
          `update outbox
           set status = 'published', published_at = now(), last_error = null
           where id = $1 and status = 'publishing'`,
          [row.id],
        );
        await query(
          `update tasks
           set message_ref = $2, updated_at = now()
           where id = $1 and message_ref is null`,
          [card.taskId, sent.ts],
        );
      });
      published += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "publish failed";
      await db.query(
        `update outbox
         set status = 'failed', last_error = $2
         where id = $1 and status = 'publishing'`,
        [row.id, message],
      );
      failed += 1;
    }
  }
  return { published, failed };
}
