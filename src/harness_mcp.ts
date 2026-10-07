/**
 * MCP tool stubs for personal Grok harnesses.
 * Same handlers as HTTP (/harness/*). Wire into an MCP server later;
 * this module only declares tool schemas + dispatches to harness_handlers.
 *
 * Grok Bot = harness only. fran-ops remains the company SoT. No Slack bot identity.
 */

import type { ChannelGrant } from "./allowlist.ts";
import type { Db } from "./db.ts";
import {
  harnessAppendAssetEvent,
  harnessRaiseIssue,
  harnessTaskInbox,
  type HarnessHandlerResult,
} from "./harness_handlers.ts";

export const HARNESS_MCP_TOOLS = [
  {
    name: "fran_ops_issue_raise",
    description:
      "Raise a hardware issue on fran-ops (creates issue row; Slack approve card is the human doorbell).",
    inputSchema: {
      type: "object",
      required: ["raiserStaffId", "idempotencyKey", "photos"],
      properties: {
        raiserStaffId: { type: "string", description: "FranHRM staff uuid" },
        caption: { type: "string" },
        threadTs: { type: "string" },
        photos: {
          type: "array",
          items: {
            type: "object",
            required: ["slackFileId"],
            properties: {
              slackFileId: { type: "string" },
              url: { type: ["string", "null"] },
            },
          },
        },
        idempotencyKey: { type: "string" },
        slackDoorbell: { type: "boolean", default: true },
      },
    },
  },
  {
    name: "fran_ops_asset_event_append",
    description: "Append-only asset_events row (crack|claim_filed|oow|repair|swap|retire).",
    inputSchema: {
      type: "object",
      required: ["serial", "eventType", "idempotencyKey"],
      properties: {
        serial: { type: "string" },
        eventType: {
          type: "string",
          enum: ["crack", "claim_filed", "oow", "repair", "swap", "retire"],
        },
        kind: { type: "string" },
        site: { type: ["string", "null"] },
        issueId: { type: ["string", "null"] },
        idempotencyKey: { type: "string" },
        payload: { type: "object" },
      },
    },
  },
  {
    name: "fran_ops_task_inbox",
    description: "Task inbox for a staff identity (/bird mine equivalent).",
    inputSchema: {
      type: "object",
      required: ["staffId"],
      properties: {
        staffId: { type: "string" },
        includeDone: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
] as const;

export type HarnessMcpToolName = (typeof HARNESS_MCP_TOOLS)[number]["name"];

export async function dispatchHarnessMcpTool(
  db: Db,
  grants: readonly ChannelGrant[],
  toolName: string,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HarnessHandlerResult<unknown>> {
  switch (toolName) {
    case "fran_ops_issue_raise":
      return harnessRaiseIssue(
        db,
        grants,
        {
          raiserStaffId: String(args.raiserStaffId ?? ""),
          caption: typeof args.caption === "string" ? args.caption : undefined,
          threadTs: typeof args.threadTs === "string" ? args.threadTs : undefined,
          photos: Array.isArray(args.photos)
            ? (args.photos as { slackFileId: string; url?: string | null }[])
            : undefined,
          idempotencyKey: String(args.idempotencyKey ?? ""),
          slackDoorbell: args.slackDoorbell === false ? false : true,
        },
        env,
      );
    case "fran_ops_asset_event_append":
      return harnessAppendAssetEvent(db, {
        serial: String(args.serial ?? ""),
        eventType: String(args.eventType ?? ""),
        kind: typeof args.kind === "string" ? args.kind : undefined,
        site: typeof args.site === "string" ? args.site : args.site === null ? null : undefined,
        issueId: typeof args.issueId === "string" ? args.issueId : args.issueId === null ? null : undefined,
        idempotencyKey: String(args.idempotencyKey ?? ""),
        payload:
          typeof args.payload === "object" && args.payload !== null && !Array.isArray(args.payload)
            ? (args.payload as Record<string, unknown>)
            : undefined,
      });
    case "fran_ops_task_inbox":
      return harnessTaskInbox(db, {
        staffId: String(args.staffId ?? ""),
        includeDone: args.includeDone === true,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
    default:
      return { ok: false, status: 404, error: `unknown tool ${toolName}` };
  }
}
