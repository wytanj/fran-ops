import { expect, test } from "bun:test";
import {
  loadThreadContext,
  pickThreadTs,
  replyThreadTs,
  summarizeThreadContext,
  threadTextsForRouting,
  type SlackRepliesClient,
} from "../src/thread.ts";

test("pickThreadTs and replyThreadTs", () => {
  expect(pickThreadTs({ thread_ts: "1700000000.1000", ts: "1700000000.2000" })).toBe("1700000000.1000");
  expect(pickThreadTs({ ts: "1700000000.2000" })).toBeNull();
  expect(replyThreadTs({ thread_ts: "1700000000.1000", ts: "1700000000.2000" })).toBe("1700000000.1000");
  expect(replyThreadTs({ ts: "1700000000.2000" })).toBe("1700000000.2000");
  expect(replyThreadTs({})).toBeUndefined();
});

test("loadThreadContext maps conversations.replies", async () => {
  const calls: unknown[] = [];
  const client: SlackRepliesClient = {
    conversations: {
      async replies(args) {
        calls.push(args);
        return {
          ok: true,
          messages: [
            { ts: "1.0", user: "U0A", text: "parent about roster" },
            { ts: "1.1", user: "U0B", text: "follow up", bot_id: "B0" },
            { ts: "1.2", user: "U0A", text: "ask franbird" },
            { ts: "bad" },
          ],
        };
      },
    },
  };
  const ctx = await loadThreadContext(client, {
    channelId: "C0OPS01",
    threadTs: "1.0",
    limit: 20,
  });
  expect(calls).toEqual([
    { channel: "C0OPS01", ts: "1.0", limit: 20, inclusive: true },
  ]);
  expect(ctx.messages).toHaveLength(3);
  expect(ctx.messages[1]?.bot).toBe(true);
  expect(threadTextsForRouting(ctx)).toEqual(["parent about roster", "ask franbird"]);
  expect(summarizeThreadContext(ctx)).toContain("roster");
});

test("loadThreadContext returns empty on throw", async () => {
  const client: SlackRepliesClient = {
    conversations: {
      async replies() {
        throw new Error("network");
      },
    },
  };
  const ctx = await loadThreadContext(client, { channelId: "C0OPS01", threadTs: "1.0" });
  expect(ctx.messages).toEqual([]);
});
