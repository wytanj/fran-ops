/**
 * HTTP surface for personal Grok harnesses.
 * Mounts on the same Express receiver as Slack / Telegram when FRAN_OPS_HARNESS_TOKEN is set.
 * Paths:
 *   POST /harness/issues/raise
 *   POST /harness/asset_events
 *   GET  /harness/tasks/mine?staffId=…
 */

import type { ChannelGrant } from "./allowlist.ts";
import { loadChannelAllowlist } from "./allowlist.ts";
import type { Db } from "./db.ts";
import { HARNESS_TOKEN_ENV, readHarnessToken, verifyHarnessAuth } from "./harness_auth.ts";
import {
  harnessAppendAssetEvent,
  harnessRaiseIssue,
  harnessTaskInbox,
} from "./harness_handlers.ts";

type ExpressLike = {
  post: (path: string, handler: (req: any, res: any) => unknown) => unknown;
  get: (path: string, handler: (req: any, res: any) => unknown) => unknown;
};

function rawBody(req: { body?: unknown; rawBody?: string }): string {
  if (typeof req.rawBody === "string") return req.rawBody;
  if (typeof req.body === "string") return req.body;
  if (req.body === undefined || req.body === null) return "";
  try {
    return JSON.stringify(req.body);
  } catch {
    return "";
  }
}

function sendResult(res: any, result: { ok: true; value: unknown } | { ok: false; status: number; error: string; reason?: string }): void {
  if (result.ok) {
    res.status(200).json({ ok: true, ...((typeof result.value === "object" && result.value !== null) ? result.value as object : { value: result.value }) });
    return;
  }
  res.status(result.status).json({
    ok: false,
    error: result.error,
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
  });
}

export function mountHarnessHttp(
  app: ExpressLike,
  opts: {
    db: Db;
    grants?: readonly ChannelGrant[];
    env?: NodeJS.ProcessEnv;
  },
): boolean {
  const env = opts.env ?? process.env;
  if (readHarnessToken(env) === null) return false;
  const grants = opts.grants ?? loadChannelAllowlist(env);

  const gate = (req: any, res: any): boolean => {
    const auth = verifyHarnessAuth({
      authorization: req.headers?.authorization as string | undefined,
      signatureHeader: (req.headers?.["x-fran-ops-signature"] as string | undefined) ?? null,
      rawBody: rawBody(req),
      env,
    });
    if (!auth.ok) {
      const status = auth.reason === "missing_token" ? 503 : 401;
      res.status(status).json({ ok: false, error: auth.reason, env: HARNESS_TOKEN_ENV });
      return false;
    }
    return true;
  };

  app.post("/harness/issues/raise", async (req: any, res: any) => {
    if (!gate(req, res)) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await harnessRaiseIssue(
        opts.db,
        grants,
        {
          raiserStaffId: String(body.raiserStaffId ?? ""),
          caption: typeof body.caption === "string" ? body.caption : undefined,
          threadTs: typeof body.threadTs === "string" ? body.threadTs : undefined,
          photos: Array.isArray(body.photos) ? (body.photos as { slackFileId: string; url?: string | null }[]) : undefined,
          idempotencyKey: String(body.idempotencyKey ?? ""),
          slackDoorbell: body.slackDoorbell === false ? false : true,
        },
        env,
      );
      sendResult(res, result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "error" });
    }
  });

  app.post("/harness/asset_events", async (req: any, res: any) => {
    if (!gate(req, res)) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await harnessAppendAssetEvent(opts.db, {
        serial: String(body.serial ?? ""),
        eventType: String(body.eventType ?? ""),
        kind: typeof body.kind === "string" ? body.kind : undefined,
        site: typeof body.site === "string" ? body.site : body.site === null ? null : undefined,
        issueId: typeof body.issueId === "string" ? body.issueId : body.issueId === null ? null : undefined,
        idempotencyKey: String(body.idempotencyKey ?? ""),
        payload:
          typeof body.payload === "object" && body.payload !== null && !Array.isArray(body.payload)
            ? (body.payload as Record<string, unknown>)
            : undefined,
      });
      sendResult(res, result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "error" });
    }
  });

  app.get("/harness/tasks/mine", async (req: any, res: any) => {
    if (!gate(req, res)) return;
    try {
      const q = req.query ?? {};
      const staffId = String(q.staffId ?? q.staff_id ?? "");
      const includeDone = q.includeDone === "1" || q.includeDone === "true";
      const limitRaw = q.limit !== undefined ? Number(q.limit) : undefined;
      const result = await harnessTaskInbox(opts.db, {
        staffId,
        includeDone,
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      });
      sendResult(res, result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "error" });
    }
  });

  return true;
}
