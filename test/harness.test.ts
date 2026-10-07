import { expect, test } from "bun:test";
import { IT_HELPDESK_CHANNEL_ID, type ChannelGrant } from "../src/allowlist.ts";
import { linkStaff, openTask } from "../src/bus.ts";
import { parseSlackUserId } from "../src/domain.ts";
import {
  extractBearer,
  hmacSha256Hex,
  readHarnessToken,
  verifyHarnessAuth,
} from "../src/harness_auth.ts";
import {
  harnessAppendAssetEvent,
  harnessRaiseIssue,
  harnessTaskInbox,
} from "../src/harness_handlers.ts";
import { dispatchHarnessMcpTool, HARNESS_MCP_TOOLS } from "../src/harness_mcp.ts";
import { freshDb } from "./harness.ts";
import { slackUser, staffA, staffB, telegramUser } from "./fixtures.ts";

const TOKEN = "test-harness-token-not-real";
const helpdeskGrants: readonly ChannelGrant[] = [
  { surface: "slack", channelId: IT_HELPDESK_CHANNEL_ID, name: "it-helpdesk" },
];
const approverSlack = parseSlackUserId("U0APPROVE");
if (approverSlack === null) throw new Error("approver");

test("harness auth bearer and hmac", () => {
  expect(readHarnessToken({})).toBeNull();
  expect(readHarnessToken({ FRAN_OPS_HARNESS_TOKEN: TOKEN })).toBe(TOKEN);
  expect(extractBearer("Bearer " + TOKEN)).toBe(TOKEN);
  expect(extractBearer("Basic x")).toBeNull();

  const env = { FRAN_OPS_HARNESS_TOKEN: TOKEN };
  expect(verifyHarnessAuth({ authorization: `Bearer ${TOKEN}`, env })).toEqual({ ok: true });
  expect(verifyHarnessAuth({ authorization: "Bearer wrong", env }).ok).toBe(false);

  const body = '{"serial":"X"}';
  const sig = "sha256=" + hmacSha256Hex(body, TOKEN);
  expect(verifyHarnessAuth({ signatureHeader: sig, rawBody: body, env })).toEqual({ ok: true });
  expect(verifyHarnessAuth({ signatureHeader: "sha256=dead", rawBody: body, env }).ok).toBe(false);
  expect(verifyHarnessAuth({ env: {} }).ok).toBe(false);
});

test("MCP tool catalog has the three harness tools", () => {
  expect(HARNESS_MCP_TOOLS.map((t) => t.name).sort()).toEqual([
    "fran_ops_asset_event_append",
    "fran_ops_issue_raise",
    "fran_ops_task_inbox",
  ]);
});

test("asset_events append and task inbox via handlers + MCP dispatch", async () => {
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

  const appended = await harnessAppendAssetEvent(db, {
    serial: "R5GL855Q7PD",
    eventType: "crack",
    kind: "mirror",
    site: "Bugis+",
    idempotencyKey: "crack-1",
  });
  expect(appended.ok).toBe(true);
  if (!appended.ok) throw new Error("append failed");

  const mcpAsset = await dispatchHarnessMcpTool(db, helpdeskGrants, "fran_ops_asset_event_append", {
    serial: "R5GL855Q7PD",
    eventType: "oow",
    idempotencyKey: "oow-1",
  });
  expect(mcpAsset.ok).toBe(true);

  const opened = await openTask(db, {
    grants: helpdeskGrants,
    templateKey: "incident",
    staffId: staffA,
    surface: "slack",
    channelId: IT_HELPDESK_CHANNEL_ID,
    idempotencyKey: "task:inbox:1",
  });
  expect(opened.ok).toBe(true);

  const inbox = await harnessTaskInbox(db, { staffId: staffA });
  expect(inbox.ok).toBe(true);
  if (!inbox.ok) throw new Error("inbox failed");
  expect(inbox.value.tasks.some((t) => t.templateKey === "incident")).toBe(true);

  const mcpInbox = await dispatchHarnessMcpTool(db, helpdeskGrants, "fran_ops_task_inbox", {
    staffId: staffA,
  });
  expect(mcpInbox.ok).toBe(true);
});

test("issue raise via harness requires photo and approver env", async () => {
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

  const noPhoto = await harnessRaiseIssue(
    db,
    helpdeskGrants,
    { raiserStaffId: staffA, idempotencyKey: "i1", photos: [] },
    { ISSUE_APPROVER_SLACK_USER_ID: approverSlack },
  );
  expect(noPhoto.ok).toBe(false);
  if (noPhoto.ok) throw new Error("expected fail");
  expect(noPhoto.reason).toBe("no_photo");

  const raised = await harnessRaiseIssue(
    db,
    helpdeskGrants,
    {
      raiserStaffId: staffA,
      idempotencyKey: "i2",
      caption: "device: S10B cracked site: Bugis+ serial: R5GL855Q7PD kind: mirror",
      photos: [{ slackFileId: "F0HARNESS1", url: null }],
      threadTs: "1710000000.9001",
    },
    { ISSUE_APPROVER_SLACK_USER_ID: approverSlack },
  );
  expect(raised.ok).toBe(true);
  if (!raised.ok) throw new Error("raise failed");
  expect(raised.value.doorbell).toBe(true);
  expect(raised.value.created).toBe(true);

  const mcpRaise = await dispatchHarnessMcpTool(
    db,
    helpdeskGrants,
    "fran_ops_issue_raise",
    {
      raiserStaffId: staffA,
      idempotencyKey: "i3",
      photos: [{ slackFileId: "F0HARNESS2" }],
      caption: "device: demo",
    },
    { ISSUE_APPROVER_SLACK_USER_ID: approverSlack },
  );
  expect(mcpRaise.ok).toBe(true);
});

test("HTTP mount no-ops without token; mounts with token", async () => {
  const { mountHarnessHttp } = await import("../src/harness_http.ts");
  const routes: string[] = [];
  const app = {
    post(path: string) {
      routes.push(`POST ${path}`);
    },
    get(path: string) {
      routes.push(`GET ${path}`);
    },
  };
  const db = await freshDb();
  expect(mountHarnessHttp(app, { db, env: {} })).toBe(false);
  expect(routes).toEqual([]);
  expect(mountHarnessHttp(app, { db, env: { FRAN_OPS_HARNESS_TOKEN: TOKEN } })).toBe(true);
  expect(routes.sort()).toEqual([
    "GET /harness/tasks/mine",
    "POST /harness/asset_events",
    "POST /harness/issues/raise",
  ]);
});
