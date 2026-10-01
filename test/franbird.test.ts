import { expect, test } from "bun:test";
import { linkStaff, openFranbirdTell } from "../src/bus.ts";
import { parseFranbirdTell, parseSlackUserId, parseTelegramUserId } from "../src/domain.ts";
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