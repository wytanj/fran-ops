import type { Db, Query } from "./db.ts";

declare const assetIdBrand: unique symbol;

export type AssetId = string & { readonly [assetIdBrand]: "AssetId" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SERIAL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KIND_RE = /^[a-z][a-z0-9_]{0,31}$/;

export const ASSET_EVENT_TYPES = [
  "crack",
  "claim_filed",
  "oow",
  "repair",
  "swap",
  "retire",
] as const;
export type AssetEventType = (typeof ASSET_EVENT_TYPES)[number];

export const ASSET_ACTORS = ["bot", "staff"] as const;
export type AssetActor = (typeof ASSET_ACTORS)[number];

export const DEFAULT_ASSET_KIND = "device";

export type AssetLogReason = "bad_serial" | "bad_kind" | "bad_payload";

export type AssetLogResult<T> = { ok: true; value: T } | { ok: false; reason: AssetLogReason };

export type AssetEventRecord = {
  id: string;
  assetId: AssetId;
  eventType: AssetEventType;
  issueId: string | null;
  actor: AssetActor;
};

export function parseAssetId(raw: string): AssetId | null {
  if (!UUID_RE.test(raw)) return null;
  return raw.toLowerCase() as AssetId;
}

export function isAssetEventType(raw: string): raw is AssetEventType {
  for (const eventType of ASSET_EVENT_TYPES) {
    if (eventType === raw) return true;
  }
  return false;
}

export function normalizeSerial(raw: string): string | null {
  const trimmed = raw.trim();
  if (!SERIAL_RE.test(trimmed)) return null;
  return trimmed;
}

export function normalizeKind(raw: string): string | null {
  const trimmed = raw.trim();
  if (!KIND_RE.test(trimmed)) return null;
  return trimmed;
}

function parseUuid(raw: string): string | null {
  if (!UUID_RE.test(raw)) return null;
  return raw.toLowerCase();
}

function requireEventType(raw: string): AssetEventType {
  if (!isAssetEventType(raw)) throw new Error(`bad asset event ${raw}`);
  return raw;
}

function requireActor(raw: string): AssetActor {
  if (raw === "bot" || raw === "staff") return raw;
  throw new Error(`bad asset actor ${raw}`);
}

function normalizeAliases(values: readonly string[]): string[] | null {
  const aliases: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || /\s/.test(trimmed)) return null;
    aliases.push(trimmed);
  }
  return aliases;
}

export async function ensureAsset(
  query: Query,
  input: {
    kind: string;
    serial: string;
    site: string | null;
    notes: string | null;
    aliases: readonly string[];
  },
): Promise<AssetId> {
  const kind = normalizeKind(input.kind);
  const serial = normalizeSerial(input.serial);
  const aliases = normalizeAliases(input.aliases);
  if (kind === null || serial === null || aliases === null) {
    throw new Error("asset identity was not normalized");
  }
  const inserted = await query<{ id: string }>(
    `insert into assets (kind, serial, aliases, site, notes)
     values ($1, $2, $3::jsonb, $4, $5)
     on conflict (serial) do nothing
     returning id`,
    [kind, serial, JSON.stringify(aliases), input.site, input.notes],
  );
  const existing =
    inserted[0]?.id === undefined
      ? await query<{ id: string }>(`select id from assets where serial = $1`, [serial])
      : inserted;
  const raw = existing[0]?.id;
  if (raw === undefined) throw new Error("asset insert returned no id");
  const assetId = parseAssetId(raw);
  if (assetId === null) throw new Error("asset id in the database is not a uuid");
  return assetId;
}

export async function appendBotEvent(
  query: Query,
  input: {
    assetId: AssetId;
    eventType: AssetEventType;
    issueId: string | null;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  },
): Promise<boolean> {
  if (input.idempotencyKey.trim() === "") throw new Error("asset event idempotency key is blank");
  const inserted = await query<{ id: string }>(
    `insert into asset_events (
       asset_id, event_type, issue_id, payload, actor, idempotency_key
     ) values ($1, $2, $3, $4::jsonb, 'bot', $5)
     on conflict (idempotency_key) do nothing
     returning id`,
    [
      input.assetId,
      input.eventType,
      input.issueId,
      JSON.stringify(input.payload),
      input.idempotencyKey,
    ],
  );
  return inserted[0] !== undefined;
}

export async function recordBotEvent(
  db: Db,
  input: {
    serial: string;
    kind: string;
    site: string | null;
    eventType: AssetEventType;
    issueId: string | null;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    aliases?: readonly string[];
  },
): Promise<AssetLogResult<{ assetId: AssetId; created: boolean }>> {
  const serial = normalizeSerial(input.serial);
  if (serial === null) return { ok: false, reason: "bad_serial" };
  const kind = normalizeKind(input.kind);
  if (kind === null) return { ok: false, reason: "bad_kind" };
  if (input.idempotencyKey.trim() === "") return { ok: false, reason: "bad_payload" };
  const issueId = input.issueId === null ? null : parseUuid(input.issueId);
  if (input.issueId !== null && issueId === null) return { ok: false, reason: "bad_payload" };
  const aliases = normalizeAliases(input.aliases ?? []);
  if (aliases === null) return { ok: false, reason: "bad_payload" };
  return db.transaction(async (query) => {
    const assetId = await ensureAsset(query, {
      kind,
      serial,
      site: input.site,
      notes: null,
      aliases,
    });
    const created = await appendBotEvent(query, {
      assetId,
      eventType: input.eventType,
      issueId,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
    });
    return { ok: true, value: { assetId, created } };
  });
}

export async function findAssetBySerial(db: Db, serial: string): Promise<AssetId | null> {
  const normalized = normalizeSerial(serial);
  if (normalized === null) return null;
  const rows = await db.query<{ id: string }>(`select id from assets where serial = $1`, [normalized]);
  const raw = rows[0]?.id;
  if (raw === undefined) return null;
  return parseAssetId(raw);
}

export async function readAssetHistory(db: Db, assetId: AssetId): Promise<AssetEventRecord[]> {
  const rows = await db.query<{
    id: string;
    asset_id: string;
    event_type: string;
    issue_id: string | null;
    actor: string;
  }>(
    `select id, asset_id, event_type, issue_id, actor
     from asset_events
     where asset_id = $1
     order by seq`,
    [assetId],
  );
  return rows.map((row) => {
    const id = parseUuid(row.id);
    const rowAssetId = parseAssetId(row.asset_id);
    if (id === null || rowAssetId === null) throw new Error("asset event id in the database is not a uuid");
    const issueId = row.issue_id === null ? null : parseUuid(row.issue_id);
    if (row.issue_id !== null && issueId === null) throw new Error("asset event issue id is not a uuid");
    return {
      id,
      assetId: rowAssetId,
      eventType: requireEventType(row.event_type),
      issueId,
      actor: requireActor(row.actor),
    };
  });
}
