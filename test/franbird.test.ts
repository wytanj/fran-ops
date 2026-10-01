import { expect, test } from "bun:test";
import { findStaffById, linkStaff, openFranbirdTell, openTask } from "../src/bus.ts";
import { franbirdTellCard } from "../src/cards.ts";
import {
  formatStaffLabel,
  parseFranbirdTell,
  parseSlackUserId,
  parseTelegramUserId,
} from "../src/domain.ts";
import { publishPending } from "../src/publish.ts";
import { freshDb } from "./harness.ts";
import { slackChannel, slackGrants, slackUser, staffA, staffB, telegramUser } from "./fixtures.ts";

const assigneeSlack = parseSlackUserId("U0STAFF2");
const assigneeTg = parseTelegramUserId("555002");
if (assigneeSlack === null || assigneeTg === null) throw new Error("assignee ids");

test("parseFranbirdTell accepts tell + briefing flag", () => {
  const ok = parseFranbirdTell("<@U0BOT> tell <@U0STAFF2> cover open briefing=required");
  expect(ok.ok).toBe(true);
  if (!ok.ok) return;
  expect(ok.value.assigneeSlackUserId).toBe(assigneeSlack);
  expect(ok.value.body).toBe("cover open");
  expect(ok.value.briefing).toBe("required");

  const bad = parseFranbirdTell("<@U0BOT> please do stuff");
  expect(bad.ok).toBe(false);
});

test("parseFranbirdTell accepts looser natural phrasing", () => {
  const cases: Array<{ text: string; body: string; briefing: "optional" | "required" }> = [
    {
      text: "please tell <@U0STAFF2> to cover open briefing=required",
      body: "cover open",
      briefing: "required",
    },
    { text: "ask <@U0STAFF2>: cover open", body: "cover open", briefing: "optional" },
    {
      text: "can you tell <@U0STAFF2> cover open briefing: optional",
      body: "cover open",
      briefing: "optional",
    },
    {
      text: "briefing=required tell <@U0STAFF2> cover open",
      body: "cover open",
      briefing: "required",
    },
    {
      text: "tell <@U0STAFF2|Alice> cover open (briefing required)",
      body: "cover open",
      briefing: "required",
    },
    { text: "@franbird tell <@U0STAFF2> cover open", body: "cover open", briefing: "optional" },
  ];
  for (const c of cases) {
    const parsed = parseFranbirdTell(c.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) continue;
    expect(parsed.value.assigneeSlackUserId).toBe(assigneeSlack);
    expect(parsed.value.body).toBe(c.body);
    expect(parsed.value.briefing).toBe(c.briefing);
  }
});

test("formatStaffLabel prefers display name then Slack mention then short id", () => {
  expect(
    formatStaffLabel({
      staffId: staffA,
      displayName: "Alice",
      slackUserId: "U0STAFF01",
    }),
  ).toBe("Alice");
  expect(formatStaffLabel({ staffId: staffA, slackUserId: "U0STAFF01" })).toBe("<@U0STAFF01>");
  expect(formatStaffLabel({ staffId: staffA })).toBe("11111111");
});

test("openFranbirdTell card uses display names not raw UUIDs", async () => {
  const db = await freshDb();
  await linkStaff(db, {
    staffId: staffA,
    employment: "full_time",
    slackUserId: slackUser,
    telegramUserId: telegramUser,
    displayName: "Jeremy",
  });
  await linkStaff(db, {
    staffId: staffB,
    employment: "part_time",
    slackUserId: assigneeSlack,
    telegramUserId: assigneeTg,
    displayName: "Alice",
  });
  const opened = await openFranbirdTell(db, {
    grants: slackGrants,
    openerStaffId: staffA,
    assigneeStaffId: staffB,
    assigneeSlackUserId: assigneeSlack,
    surface: "slack",
    channelId: slackChannel,
    body: "cover open",
    briefing: "required",
    idempotencyKey: "slack:app_mention:evt-tell-names",
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const outbox = await db.query<{ payload: { blocks: Array<{ text?: { text?: string } }> } }>(
    `select payload from outbox where id = $1`,
    [opened.value.outboxId],
  );
  const section = outbox[0]?.payload?.blocks?.find((b) => b.text?.text?.includes("To"));
  const mrkdwn = section?.text?.text ?? "";
  expect(mrkdwn).toContain("Alice");
  expect(mrkdwn).toContain("Jeremy");
  expect(mrkdwn).not.toContain(staffA);
  expect(mrkdwn).not.toContain(staffB);

  const identity = await findStaffById(db, staffA);
  expect(identity?.displayName).toBe("Jeremy");
});

test("franbirdTellCard renders labels", () => {
  const card = franbirdTellCard({
    taskId: "t1",
    body: "hi",
    openerLabel: "Jeremy",
    assigneeLabel: "Alice",
    briefing: "optional",
  });
  const section = card.blocks.find((b) => b.type === "section" && "text" in b);
  expect(JSON.stringify(section)).toContain("Jeremy");
  expect(JSON.stringify(section)).toContain("Alice");
});

test("openFranbirdTell writes task + ack/dm outbox and publishes via chat.postMessage path", async () => {
  const db = await freshDb();
  await linkStaff(db, {
    staffId: staffA,
    employment: "full_time",
    slackUserId: slackUser,
    telegramUserId: telegramUser,
  });
  await linkStaff(db, {
    staffId: staffB,
    employment: "part_time",
    slackUserId: assigneeSlack,
    telegramUserId: assigneeTg,
  });
  const opened = await openFranbirdTell(db, {
    grants: slackGrants,
    openerStaffId: staffA,
    assigneeStaffId: staffB,
    assigneeSlackUserId: assigneeSlack,
    surface: "slack",
    channelId: slackChannel,
    body: "cover open",
    briefing: "required",
    idempotencyKey: "slack:app_mention:evt-tell-1",
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const tasks = await db.query<{ briefing_required: boolean; assignee_staff_id: string; template_key: string }>(
    `select briefing_required, assignee_staff_id, template_key from tasks where id = $1`,
    [opened.value.taskId],
  );
  expect(tasks[0]?.template_key).toBe("tell");
  expect(tasks[0]?.briefing_required).toBe(true);
  expect(tasks[0]?.assignee_staff_id).toBe(staffB);

  const posts: string[] = [];
  const published = await publishPending(db, {
    async post(message) {
      posts.push(message.channel);
      return { ts: `1700000${posts.length}.0001` };
    },
  });
  expect(published.published).toBe(3);
  expect(posts).toContain(slackChannel);
  expect(posts).toContain(assigneeSlack);
});

test("openTask draft card uses short id when display name missing", async () => {
  const db = await freshDb();
  await linkStaff(db, {
    staffId: staffA,
    employment: "full_time",
    slackUserId: slackUser,
    telegramUserId: telegramUser,
  });
  const opened = await openTask(db, {
    grants: slackGrants,
    templateKey: "shift_open",
    staffId: staffA,
    surface: "slack",
    channelId: slackChannel,
    idempotencyKey: "slack:command:trigger-short",
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const outbox = await db.query<{ payload: { blocks: Array<{ text?: { text?: string } }> } }>(
    `select payload from outbox where id = $1`,
    [opened.value.outboxId],
  );
  const blob = JSON.stringify(outbox[0]?.payload ?? {});
  expect(blob).toContain("<@U0STAFF01>");
  expect(blob).not.toContain(staffA);
});