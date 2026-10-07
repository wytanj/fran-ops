/**
 * Auth for personal Grok harnesses talking to fran-ops.
 * Shared secret from env — never commit real values.
 * Prefer Authorization: Bearer <token>. Optional HMAC body signature:
 *   X-Fran-Ops-Signature: sha256=<hex(hmac_sha256(body, token))>
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const HARNESS_TOKEN_ENV = "FRAN_OPS_HARNESS_TOKEN";

export type HarnessAuthReason = "missing_token" | "unauthorized" | "bad_signature";

export type HarnessAuthResult =
  | { ok: true }
  | { ok: false; reason: HarnessAuthReason };

export function readHarnessToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env[HARNESS_TOKEN_ENV] ?? "").trim();
  return raw.length > 0 ? raw : null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function extractBearer(authorization: string | undefined | null): string | null {
  if (authorization === undefined || authorization === null) return null;
  const m = authorization.trim().match(/^Bearer\s+(.+)$/i);
  if (m === null) return null;
  const token = m[1]!.trim();
  return token.length > 0 ? token : null;
}

export function hmacSha256Hex(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function verifyHarnessAuth(input: {
  authorization?: string | null;
  signatureHeader?: string | null;
  rawBody?: string | null;
  env?: NodeJS.ProcessEnv;
}): HarnessAuthResult {
  const expected = readHarnessToken(input.env ?? process.env);
  if (expected === null) return { ok: false, reason: "missing_token" };

  const bearer = extractBearer(input.authorization);
  if (bearer !== null && safeEqual(bearer, expected)) return { ok: true };

  const sigRaw = (input.signatureHeader ?? "").trim();
  const body = input.rawBody ?? "";
  if (sigRaw.length > 0) {
    const hex = sigRaw.replace(/^sha256=/i, "").trim().toLowerCase();
    const want = hmacSha256Hex(body, expected);
    if (/^[0-9a-f]+$/.test(hex) && safeEqual(hex, want)) return { ok: true };
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: false, reason: "unauthorized" };
}
