/**
 * Hot / warm / cold storage contract.
 * HOT = Postgres index only (no blobs). WARM = git contextpacks/. COLD = Drive/bucket URI.
 */

export type StorageTier = "hot" | "warm" | "cold";

export const MEDIA_SOURCES = [
  "whatsapp",
  "slack",
  "telegram",
  "upload",
  "agent",
] as const;
export type MediaSource = (typeof MEDIA_SOURCES)[number];

export const CONTEXTPACK_KINDS = [
  "daily",
  "monthly",
  "rollup",
  "example",
  "other",
] as const;
export type ContextpackKind = (typeof CONTEXTPACK_KINDS)[number];

export type MediaIndexRow = {
  id: string;
  source: MediaSource;
  external_jid: string;
  occurred_at: Date | string;
  tags: string[];
  staff_id: string | null;
  task_id: string | null;
  warm_pack_path: string | null;
  cold_uri: string | null;
  slack_file_ref: string | null;
  mime_hint: string | null;
  bytes_hint: number | null;
  notes: string | null;
  created_at: Date | string;
};

export type MediaIndexInsert = {
  source: MediaSource;
  external_jid: string;
  occurred_at: Date | string;
  tags?: string[];
  staff_id?: string | null;
  task_id?: string | null;
  warm_pack_path?: string | null;
  cold_uri?: string | null;
  slack_file_ref?: string | null;
  mime_hint?: string | null;
  bytes_hint?: number | null;
  notes?: string | null;
};

export type ContextpackMetaRow = {
  path: string;
  kind: ContextpackKind;
  last_rolled_at: Date | string | null;
  bytes_approx: number | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type WarmPackInput = {
  title: string;
  summary: string;
  pointers: Array<{ label: string; uri: string }>;
};

/** Reject absolute paths, `..`, and anything outside contextpacks/. */
export function assertContextpackRelativePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("contextpack path must be non-empty");
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    throw new Error("contextpack path must be git-relative, not absolute");
  }
  if (trimmed.includes("..")) {
    throw new Error("contextpack path must not contain ..");
  }
  const normalized = trimmed.replace(/\\/g, "/");
  if (!normalized.startsWith("contextpacks/")) {
    throw new Error("contextpack path must start with contextpacks/");
  }
  return normalized;
}

/** Build a relative warm path under contextpacks/wa/YYYY/MM/DD/. */
export function warmWaPackPath(occurredAt: Date, externalRefSlug: string): string {
  const slug = externalRefSlug.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!slug) {
    throw new Error("externalRefSlug must be non-empty");
  }
  const y = occurredAt.getUTCFullYear();
  const m = String(occurredAt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(occurredAt.getUTCDate()).padStart(2, "0");
  return assertContextpackRelativePath(
    `contextpacks/wa/${y}/${m}/${d}/${slug}.md`,
  );
}

export type BlobishPayload = {
  bytes?: Uint8Array | ArrayBuffer | Buffer | string | null;
  blob?: unknown;
  data?: Uint8Array | ArrayBuffer | Buffer | null;
  contentBase64?: string | null;
  fileBytes?: unknown;
};

/**
 * Hot tier must never accept embedded blobs.
 * Call before building a MediaIndexInsert or writing warm packs that claim to be index-only.
 */
export function assertNoBlobPayload(payload: BlobishPayload | Record<string, unknown>): void {
  const forbidden = ["bytes", "blob", "data", "contentBase64", "fileBytes"] as const;
  for (const key of forbidden) {
    const value = (payload as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) {
      throw new Error(`hot/warm index payload must not include ${key}; use cold_uri or warm_pack_path`);
    }
  }
}

/** Short curated markdown for the warm tier. Keep packs lean; fat content stays cold. */
export function buildWarmPackMarkdown(input: WarmPackInput): string {
  const title = input.title.trim() || "Untitled";
  const summary = input.summary.trim() || "(no summary)";
  const lines = [
    `# ${title}`,
    "",
    summary,
    "",
    "## Pointers",
    "",
  ];
  if (input.pointers.length === 0) {
    lines.push("- (none)");
  } else {
    for (const p of input.pointers) {
      lines.push(`- [${p.label}](${p.uri})`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export type DbQueryFn = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

/**
 * Insert a media_index row via an injected query fn.
 * Does not open a live DB connection; callers pass harness or pg wrappers.
 */
export async function recordMediaIndex(
  query: DbQueryFn,
  input: MediaIndexInsert,
): Promise<MediaIndexRow> {
  assertNoBlobPayload(input as unknown as Record<string, unknown>);
  if (input.warm_pack_path) {
    assertContextpackRelativePath(input.warm_pack_path);
  }
  const hasPointer =
    Boolean(input.warm_pack_path) ||
    Boolean(input.cold_uri) ||
    Boolean(input.slack_file_ref);
  if (!hasPointer) {
    throw new Error("media_index row needs warm_pack_path, cold_uri, or slack_file_ref");
  }

  const tags = input.tags ?? [];
  const rows = await query<MediaIndexRow>(
    `insert into media_index (
      source, external_jid, occurred_at, tags, staff_id, task_id,
      warm_pack_path, cold_uri, slack_file_ref, mime_hint, bytes_hint, notes
    ) values (
      $1, $2, $3, $4::text[], $5, $6,
      $7, $8, $9, $10, $11, $12
    )
    returning *`,
    [
      input.source,
      input.external_jid,
      input.occurred_at,
      tags,
      input.staff_id ?? null,
      input.task_id ?? null,
      input.warm_pack_path ?? null,
      input.cold_uri ?? null,
      input.slack_file_ref ?? null,
      input.mime_hint ?? null,
      input.bytes_hint ?? null,
      input.notes ?? null,
    ],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("media_index insert returned no row");
  }
  return row;
}

export function placeholderColdUri(source: MediaSource, externalRef: string): string {
  const ref = encodeURIComponent(externalRef.trim());
  return `drive://PENDING/${source}/${ref}`;
}
