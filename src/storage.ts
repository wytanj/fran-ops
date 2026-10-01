/**
 * Hot / warm / blob / Drive-folder storage contract.
 * HOT = Postgres index only (no blobs, no long-lived signed URLs).
 * WARM = git contextpacks/.
 * BLOBS = Supabase Storage (primary cold/warm objects); mint signed URLs at read time.
 * Drive = folder purpose index only (not the main dump).
 */

export type StorageTier = "hot" | "warm" | "blob" | "drive_folder";

/** @deprecated Prefer "blob" (Supabase Storage). Kept as alias for readability in docs. */
export type LegacyColdTier = "cold";

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

/** Default bucket name until JT configures Supabase Storage policy. */
export const DEFAULT_STORAGE_BUCKET = "fran-ops-media";

export type MediaIndexRow = {
  id: string;
  source: MediaSource;
  external_jid: string;
  occurred_at: Date | string;
  tags: string[];
  staff_id: string | null;
  task_id: string | null;
  warm_pack_path: string | null;
  /** Supabase Storage object path (bucket/key). Not a signed URL. */
  supabase_object_path: string | null;
  /** Optional association with a human Drive folder (not blob location). */
  drive_folder_id: string | null;
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
  supabase_object_path?: string | null;
  drive_folder_id?: string | null;
  slack_file_ref?: string | null;
  mime_hint?: string | null;
  bytes_hint?: number | null;
  notes?: string | null;
};

export type DriveFolderRecord = {
  folder_id: string;
  name: string;
  purpose: string;
  contextpack_path: string | null;
  parent_folder_id: string | null;
  staff_id: string | null;
  tags: string[];
  created_at: Date | string;
  updated_at: Date | string;
};

export type DriveFolderInsert = {
  folder_id: string;
  name: string;
  purpose: string;
  contextpack_path?: string | null;
  parent_folder_id?: string | null;
  staff_id?: string | null;
  tags?: string[];
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

/**
 * Build a Supabase Storage object path: `bucket/objectKey`.
 * Object key uses pending/<source>/<ref> until real upload lands.
 * Do not put signed URLs here — mint at read time via mintSignedUrl.
 */
export function buildSupabaseObjectPath(opts: {
  source: MediaSource;
  externalRef: string;
  bucket?: string;
  objectKey?: string;
}): string {
  const bucket = (opts.bucket ?? DEFAULT_STORAGE_BUCKET).trim();
  if (!bucket || bucket.includes("/") || bucket.includes("..")) {
    throw new Error("storage bucket must be a non-empty segment without / or ..");
  }
  let objectKey = opts.objectKey?.trim();
  if (!objectKey) {
    const ref = opts.externalRef.trim().replace(/\\/g, "/");
    if (!ref) {
      throw new Error("externalRef must be non-empty");
    }
    objectKey = `pending/${opts.source}/${ref}`;
  }
  const normalizedKey = objectKey.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalizedKey || normalizedKey.includes("..")) {
    throw new Error("object key must be non-empty and must not contain ..");
  }
  return `${bucket}/${normalizedKey}`;
}

/**
 * Placeholder path until JT configures the Supabase Storage bucket/policy.
 * Prefer buildSupabaseObjectPath for new call sites.
 */
export function placeholderSupabaseObjectPath(
  source: MediaSource,
  externalRef: string,
): string {
  return buildSupabaseObjectPath({ source, externalRef });
}

/**
 * Mint a short-lived signed URL for a Supabase Storage object at read time.
 * TODO: implement with SUPABASE_URL + service role; never persist the result in media_index.
 */
export async function mintSignedUrl(
  _supabaseObjectPath: string,
  _expiresInSeconds?: number,
): Promise<string> {
  throw new Error(
    "TODO: mintSignedUrl — needs SUPABASE_URL + service role; do not store signed URLs in DB",
  );
}

export type BlobishPayload = {
  bytes?: Uint8Array | ArrayBuffer | Buffer | string | null;
  blob?: unknown;
  data?: Uint8Array | ArrayBuffer | Buffer | null;
  contentBase64?: string | null;
  fileBytes?: unknown;
  /** Signed URLs expire — never accept them as durable index fields. */
  signed_url?: string | null;
  signedUrl?: string | null;
  signed_url_hint?: string | null;
};

/**
 * Hot tier must never accept embedded blobs or long-lived signed URLs.
 * Call before building a MediaIndexInsert or writing warm packs that claim to be index-only.
 */
export function assertNoBlobPayload(payload: BlobishPayload | Record<string, unknown>): void {
  const forbidden = [
    "bytes",
    "blob",
    "data",
    "contentBase64",
    "fileBytes",
    "signed_url",
    "signedUrl",
    "signed_url_hint",
  ] as const;
  for (const key of forbidden) {
    const value = (payload as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) {
      throw new Error(
        `hot/warm index payload must not include ${key}; use supabase_object_path or warm_pack_path (mint signed URLs at read time)`,
      );
    }
  }
}

/** Short curated markdown for the warm tier. Keep packs lean; fat content stays in Supabase Storage. */
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
    Boolean(input.supabase_object_path) ||
    Boolean(input.slack_file_ref);
  if (!hasPointer) {
    throw new Error(
      "media_index row needs warm_pack_path, supabase_object_path, or slack_file_ref",
    );
  }

  const tags = input.tags ?? [];
  const rows = await query<MediaIndexRow>(
    `insert into media_index (
      source, external_jid, occurred_at, tags, staff_id, task_id,
      warm_pack_path, supabase_object_path, drive_folder_id, slack_file_ref,
      mime_hint, bytes_hint, notes
    ) values (
      $1, $2, $3, $4::text[], $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13
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
      input.supabase_object_path ?? null,
      input.drive_folder_id ?? null,
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

/**
 * Register a human Drive folder purpose row (not a blob upload).
 */
export async function recordDriveFolder(
  query: DbQueryFn,
  input: DriveFolderInsert,
): Promise<DriveFolderRecord> {
  const folderId = input.folder_id.trim();
  const name = input.name.trim();
  const purpose = input.purpose.trim();
  if (!folderId || !name || !purpose) {
    throw new Error("drive_folders require folder_id, name, and purpose");
  }
  if (input.contextpack_path) {
    assertContextpackRelativePath(input.contextpack_path);
  }
  const tags = input.tags ?? [];
  const rows = await query<DriveFolderRecord>(
    `insert into drive_folders (
      folder_id, name, purpose, contextpack_path, parent_folder_id, staff_id, tags
    ) values (
      $1, $2, $3, $4, $5, $6, $7::text[]
    )
    returning *`,
    [
      folderId,
      name,
      purpose,
      input.contextpack_path ?? null,
      input.parent_folder_id ?? null,
      input.staff_id ?? null,
      tags,
    ],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("drive_folders insert returned no row");
  }
  return row;
}
