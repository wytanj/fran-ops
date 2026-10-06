import { expect, test } from "bun:test";
import { IT_HELPDESK_CHANNEL_ID, type ChannelGrant } from "../src/allowlist.ts";
import { linkStaff } from "../src/bus.ts";
import type { Db } from "../src/db.ts";
import { parseSlackUserId, parseStaffId } from "../src/domain.ts";
import { decideHardwareIssue, raiseHardwareIssue } from "../src/issue_bus.ts";
import {
  hardwareCarePlusDraft,
  nextIssueStatus,
  parseHardwareCaption,
} from "../src/issue_domain.ts";
import { handleHardwareChannelFile, handleIssueCardAction, type HardwareSlackFile } from "../src/issue_handlers.ts";
import { publishPending, type SlackPost, type SlackPoster } from "../src/publish.ts";
import { parseHardwareSlackFile } from "../src/slack.ts";
import { freshDb } from "./harness.ts";
import { slackChannel, slackGrants, slackUser, staffA, staffB, telegramUser } from "./fixtures.ts";

const approverSlack = parseSlackUserId("U0APPROVE");
const stranger = parseStaffId("33333333-3333-4333-8333-333333333333");
if (approverSlack === null || stranger === null) throw new Error("fixture ids");

const SEED = "device: S10B cracked site: Bugis+ mirror tablet drop: 900mm";
const THREAD = "1710000000.1001";

const helpdeskGrants: readonly ChannelGrant[] = [
  { surface: "slack", channelId: IT_HELPDESK_CHANNEL_ID, name: "it-helpdesk" },
];

function recordingPoster(): SlackPoster & { posts: SlackPost[] } {
  const posts: SlackPost[] = [];
  return {
    posts,
    async post(message) {
      posts.push(message);
      return { ts: "1710000000.2001" };
    },
  };
}

async function count(db: Db, table: "issues" | "tasks" | "outbox"): Promise<number> {
  const rows = await db.query<{ n: string }>(`select count(*)::text as n from ${table}`);
  return Number(rows[0]?.n ?? 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evidenceOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of value) {
    if (isRecord(item)) out.push(item);
  }
  return out;
}

async function linkedDb(): Promise<Db> {
  const db = await freshDb();
  await linkStaff(db, {
    staffId: staffA,
    employment: "part_time",
    slackUserId: slackUser,
    telegramUserId: telegramUser,
  });
  await linkStaff(db, {
    staffId: staffB,
    employment: "full_time",
    slackUserId: approverSlack,
    telegramUserId: null,
  });
  return db;
}

function photo(eventId: string): HardwareSlackFile {
  return {
    eventId,
    channelId: IT_HELPDESK_CHANNEL_ID,
    slackUserId: slackUser,
    caption: SEED,
    threadTs: THREAD,
    photos: [{ slackFileId: "F0S10B01", url: "https://files.example/s10b.jpg" }],
  };
}

test("caption labels fill the Care+ draft and only waiting_approve can move", () => {
  expect(parseHardwareCaption(SEED)).toEqual({
    device: "S10B cracked",
    site: "Bugis+ mirror tablet",
    dropHeightMm: 900,
    caption: SEED,
  });
  expect(parseHardwareCaption("dropped ~900mm")).toEqual({
    device: null,
    site: null,
    dropHeightMm: 900,
    caption: "dropped ~900mm",
  });
  const draft = hardwareCarePlusDraft({
    issueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    payload: {
      device: null,
      site: null,
      dropHeightMm: null,
      caption: null,
      photoRefs: [],
    },
  });
  expect(draft.to).toBe("Samsung Care+");
  expect(draft.subject).toBe("Care+ claim unknown at unknown");
  expect(draft.body).toContain("Drop height: unknown");
  expect(draft.body).toContain("This draft was not sent.");
  expect(nextIssueStatus("waiting_approve", "approve")).toBe("in_progress");
  expect(nextIssueStatus("waiting_approve", "send_back")).toBe("blocked");
  expect(nextIssueStatus("open", "approve")).toBeNull();
  expect(nextIssueStatus("in_progress", "approve")).toBeNull();
  expect(nextIssueStatus("blocked", "send_back")).toBeNull();
  expect(nextIssueStatus("done", "approve")).toBeNull();
});

test("a helpdesk image is a raise and a bot or pdf is not", () => {
  const body = { event_id: "Ev0S10B" };
  const parsed = parseHardwareSlackFile(
    {
      type: "message",
      subtype: "file_share",
      user: slackUser,
      channel: IT_HELPDESK_CHANNEL_ID,
      ts: THREAD,
      text: SEED,
      files: [{ id: "F0S10B01", mimetype: "image/jpeg", url_private: "https://files.example/s10b.jpg" }],
    },
    body,
  );
  expect(parsed).toEqual(photo("Ev0S10B"));
  const threaded = parseHardwareSlackFile(
    {
      type: "message",
      user: slackUser,
      channel: IT_HELPDESK_CHANNEL_ID,
      ts: "1710000000.3001",
      thread_ts: "1710000000.0001",
      files: [{ id: "F0S10B01", filetype: "png" }],
    },
    body,
  );
  expect(threaded?.threadTs).toBe("1710000000.0001");
  expect(threaded?.caption).toBe("");
  expect(
    parseHardwareSlackFile(
      {
        type: "message",
        bot_id: "B0",
        user: slackUser,
        channel: IT_HELPDESK_CHANNEL_ID,
        ts: THREAD,
        files: [{ id: "F0S10B01", mimetype: "image/jpeg" }],
      },
      body,
    ),
  ).toBeNull();
  expect(
    parseHardwareSlackFile(
      {
        type: "message",
        user: slackUser,
        channel: IT_HELPDESK_CHANNEL_ID,
        ts: THREAD,
        files: [{ id: "F0PDF", mimetype: "application/pdf" }],
      },
      body,
    ),
  ).toBeNull();
});

test("helpdesk photo raises one issue, stamps the thread, and approve writes one Care+ draft", async () => {
  const db = await linkedDb();
  const quiet = await handleHardwareChannelFile(db, helpdeskGrants, photo("Ev0QUIET"), null);
  expect(quiet).toEqual({ raised: false, reason: "approver_unconfigured" });
  expect(await count(db, "issues")).toBe(0);

  const first = await handleHardwareChannelFile(db, helpdeskGrants, photo("Ev0S10B"), approverSlack);
  expect(first.raised).toBe(true);
  expect(first.created).toBe(true);
  const issueId = first.issueId;
  if (issueId === undefined) throw new Error("missing issue id");
  const retry = await handleHardwareChannelFile(db, helpdeskGrants, photo("Ev0S10B"), approverSlack);
  expect(retry).toEqual({ raised: true, issueId, created: false });
  expect(await count(db, "issues")).toBe(1);
  expect(await count(db, "tasks")).toBe(0);

  const stored = await db.query<{
    playbook: string;
    status: string;
    payload: unknown;
    evidence: unknown;
  }>(`select playbook, status, payload, evidence from issues where id = $1`, [issueId]);
  expect(stored[0]?.playbook).toBe("hardware");
  expect(stored[0]?.status).toBe("waiting_approve");
  expect(isRecord(stored[0]?.payload) ? stored[0]?.payload : null).toMatchObject({
    device: "S10B cracked",
    site: "Bugis+ mirror tablet",
    dropHeightMm: 900,
    photoRefs: [{ slackFileId: "F0S10B01", url: "https://files.example/s10b.jpg" }],
  });
  const initial = evidenceOf(stored[0]?.evidence);
  expect(initial.map((entry) => entry.kind)).toEqual(["slack_file", "slack_thread"]);

  const queued = await db.query<{ card_template: string; payload: unknown }>(
    `select card_template, payload from outbox`,
  );
  expect(queued).toHaveLength(1);
  expect(queued[0]?.card_template).toBe("issue_approve");
  const card = isRecord(queued[0]?.payload) ? queued[0]?.payload : null;
  expect(card?.bindMessageRef).toBe(false);
  expect(card?.threadTs).toBe(THREAD);
  expect(card?.text).toBe(`Hardware issue ${issueId}`);

  const poster = recordingPoster();
  const published = await publishPending(db, poster);
  expect(published).toEqual({ published: 1, failed: 0 });
  expect(poster.posts[0]?.threadTs).toBe(THREAD);
  expect(poster.posts[0]?.text).toBe(`Hardware issue ${issueId}`);
  expect(JSON.stringify(poster.posts[0]?.blocks)).toContain("issue.approve");
  expect(await count(db, "tasks")).toBe(0);

  const strangerClick = await handleIssueCardAction(db, {
    actionId: "issue.approve",
    issueId,
    slackUserId: slackUser,
    actionTs: "1710000001.0001",
  });
  expect(strangerClick.recorded).toBe(false);
  expect(strangerClick.reply).toBe("Only the hardware approver can decide this issue.");

  const approved = await handleIssueCardAction(db, {
    actionId: "issue.approve",
    issueId,
    slackUserId: approverSlack,
    actionTs: "1710000001.0002",
  });
  expect(approved.recorded).toBe(true);
  expect(approved.card?.text).toBe(`Hardware issue ${issueId} approved`);
  const again = await handleIssueCardAction(db, {
    actionId: "issue.approve",
    issueId,
    slackUserId: approverSlack,
    actionTs: "1710000001.0002",
  });
  expect(again.recorded).toBe(true);
  const late = await handleIssueCardAction(db, {
    actionId: "issue.approve",
    issueId,
    slackUserId: approverSlack,
    actionTs: "1710000001.0003",
  });
  expect(late).toEqual({
    recorded: false,
    reply: "That issue is not waiting for approval.",
  });

  const after = await db.query<{ status: string; evidence: unknown }>(
    `select status, evidence from issues where id = $1`,
    [issueId],
  );
  expect(after[0]?.status).toBe("in_progress");
  const drafts = evidenceOf(after[0]?.evidence).filter((entry) => entry.kind === "email_draft");
  expect(drafts).toHaveLength(1);
  expect(drafts[0]?.delivery).toBe("outbox_ready");
  expect(drafts[0]?.to).toBe("Samsung Care+");
  expect(drafts[0]?.subject).toBe("Care+ claim S10B cracked at Bugis+ mirror tablet");
  expect(drafts[0]?.body).toContain("Device: S10B cracked");
  expect(drafts[0]?.body).toContain("Site: Bugis+ mirror tablet");
  expect(drafts[0]?.body).toContain("Drop height: 900 mm");
  expect(drafts[0]?.body).toContain(`Issue: ${issueId}`);
  expect(drafts[0]?.body).toContain("F0S10B01 https://files.example/s10b.jpg");
  expect(drafts[0]?.body).toContain("This draft was not sent.");
  expect(await count(db, "outbox")).toBe(1);
});

test("send back blocks the issue and a photo outside helpdesk does not open one", async () => {
  const db = await linkedDb();
  const raised = await handleHardwareChannelFile(db, helpdeskGrants, photo("Ev0BACK"), approverSlack);
  const issueId = raised.issueId;
  if (issueId === undefined) throw new Error("missing issue id");
  const sent = await handleIssueCardAction(db, {
    actionId: "issue.send_back",
    issueId,
    slackUserId: approverSlack,
    actionTs: "1710000002.0001",
  });
  expect(sent.recorded).toBe(true);
  expect(sent.card?.text).toBe(`Hardware issue ${issueId} sent back`);
  const row = await db.query<{ status: string; evidence: unknown }>(
    `select status, evidence from issues where id = $1`,
    [issueId],
  );
  expect(row[0]?.status).toBe("blocked");
  const notes = evidenceOf(row[0]?.evidence).filter((entry) => entry.kind === "note");
  expect(notes).toEqual([{ kind: "note", text: "send back", staffId: staffB }]);
  expect(evidenceOf(row[0]?.evidence).some((entry) => entry.kind === "email_draft")).toBe(false);
  const follow = await handleIssueCardAction(db, {
    actionId: "issue.approve",
    issueId,
    slackUserId: approverSlack,
    actionTs: "1710000002.0002",
  });
  expect(follow.recorded).toBe(false);

  const elsewhere = await raiseHardwareIssue(db, {
    grants: slackGrants,
    channelId: slackChannel,
    raiserStaffId: staffA,
    approverStaffId: staffB,
    threadTs: THREAD,
    caption: SEED,
    photos: [{ slackFileId: "F0S10B01", url: "https://files.example/s10b.jpg" }],
    idempotencyKey: "slack:issue:elsewhere",
  });
  expect(elsewhere).toEqual({ ok: false, reason: "not_helpdesk" });
  const unlisted = await raiseHardwareIssue(db, {
    grants: slackGrants,
    channelId: IT_HELPDESK_CHANNEL_ID,
    raiserStaffId: staffA,
    approverStaffId: staffB,
    threadTs: THREAD,
    caption: SEED,
    photos: [{ slackFileId: "F0S10B01", url: "https://files.example/s10b.jpg" }],
    idempotencyKey: "slack:issue:unlisted",
  });
  expect(unlisted).toEqual({ ok: false, reason: "channel_not_allowlisted" });
  const noPhoto = await raiseHardwareIssue(db, {
    grants: helpdeskGrants,
    channelId: IT_HELPDESK_CHANNEL_ID,
    raiserStaffId: staffA,
    approverStaffId: staffB,
    threadTs: THREAD,
    caption: SEED,
    photos: [],
    idempotencyKey: "slack:issue:nophoto",
  });
  expect(noPhoto).toEqual({ ok: false, reason: "no_photo" });
  const unknown = await raiseHardwareIssue(db, {
    grants: helpdeskGrants,
    channelId: IT_HELPDESK_CHANNEL_ID,
    raiserStaffId: stranger,
    approverStaffId: staffB,
    threadTs: THREAD,
    caption: SEED,
    photos: [{ slackFileId: "F0S10B01", url: null }],
    idempotencyKey: "slack:issue:stranger",
  });
  expect(unknown).toEqual({ ok: false, reason: "unknown_staff" });
  expect(await count(db, "issues")).toBe(1);

  await expect(
    db.query(`update issues set status = 'archived' where id = $1`, [issueId]),
  ).rejects.toThrow();
  await db.query(`update issues set status = 'done' where id = $1`, [issueId]);
  await db.query(`update issues set status = 'open' where id = $1`, [issueId]);
  const statuses = await db.query<{ status: string }>(`select status from issues where id = $1`, [issueId]);
  expect(statuses[0]?.status).toBe("open");
  const stuck = await decideHardwareIssue(db, {
    issueId,
    action: "approve",
    actorStaffId: staffB,
    idempotencyKey: "slack:issue:open-approve",
  });
  expect(stuck).toEqual({ ok: false, reason: "bad_status" });
});
