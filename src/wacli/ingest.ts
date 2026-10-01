/**
 * WhatsApp → warm pack + media_index payload stubs.
 * Versioned file objects target Supabase Storage (upload stub TODO); retrieve/replace as artifacts evolve.
 * Does NOT use Drive as the version store or bulk dump; optional Drive folder context is separate.
 */

import {
  assertNoBlobPayload,
  buildWarmPackMarkdown,
  placeholderSupabaseObjectPath,
  warmWaPackPath,
  type DriveFolderInsert,
  type MediaIndexInsert,
} from "../storage.ts";
import type { WaIngestResult, WaMediaRef, WaTextRef } from "./types.ts";

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function slugFromMessage(chatJid: string, messageId: string): string {
  const raw = `${chatJid}-${messageId}`;
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 80);
}

/**
 * Build a short warm markdown pack path + MediaIndex insert for a WA media message.
 * Caller is responsible for writing `warmMarkdown` to disk at `warmPackPath`.
 *
 * TODO: upload local media to Supabase Storage and set a real supabase_object_path
 *       (needs SUPABASE_URL + service role + bucket/policy from JT).
 * TODO: optional post of a recent copy to an allowlisted Slack channel (needs #1 Slack install).
 * Do not use Drive as the version store; use it for contextual/organized placement.
 */
export function ingestWaMedia(ref: WaMediaRef): WaIngestResult {
  assertNoBlobPayload(ref as unknown as Record<string, unknown>);
  const occurredAt = asDate(ref.occurredAt);
  const slug = slugFromMessage(ref.chatJid, ref.messageId);
  const warmPackPath = warmWaPackPath(occurredAt, slug);
  const supabaseObjectPath = placeholderSupabaseObjectPath(
    "whatsapp",
    `${ref.chatJid}/${ref.messageId}`,
  );

  const summaryParts = [
    `WhatsApp ${ref.kind} from \`${ref.chatJid}\`.`,
    ref.caption ? `Caption: ${ref.caption.trim()}` : null,
    ref.localPath
      ? `Local path (not uploaded): \`${ref.localPath}\`.`
      : "No local path yet.",
    "Blob: placeholder Supabase Storage path until JT configures the bucket/policy.",
  ].filter(Boolean) as string[];

  const warmMarkdown = buildWarmPackMarkdown({
    title: `WA ${ref.kind} ${ref.messageId}`,
    summary: summaryParts.join(" "),
    pointers: [
      { label: "storage (pending)", uri: `supabase://${supabaseObjectPath}` },
      ...(ref.localPath
        ? [{ label: "local (dev only)", uri: `file://${ref.localPath}` }]
        : []),
    ],
  });

  const mediaIndexInsert: MediaIndexInsert = {
    source: "whatsapp",
    external_jid: `${ref.chatJid}/${ref.messageId}`,
    occurred_at: occurredAt.toISOString(),
    tags: ["whatsapp", ref.kind],
    warm_pack_path: warmPackPath,
    supabase_object_path: supabaseObjectPath,
    mime_hint: ref.mimeHint ?? null,
    bytes_hint: ref.bytesHint ?? null,
    notes: ref.localPath ? `localPath=${ref.localPath}` : null,
  };

  return { warmPackPath, warmMarkdown, mediaIndexInsert };
}

/**
 * Build a short warm pack for a WA text message (no blob expected).
 * Still records a media_index row with warm_pack_path only.
 */
export function ingestWaText(ref: WaTextRef): WaIngestResult {
  assertNoBlobPayload(ref as unknown as Record<string, unknown>);
  const occurredAt = asDate(ref.occurredAt);
  const slug = slugFromMessage(ref.chatJid, ref.messageId);
  const warmPackPath = warmWaPackPath(occurredAt, `txt-${slug}`);
  const excerpt = ref.text.trim().slice(0, 400);

  const warmMarkdown = buildWarmPackMarkdown({
    title: `WA text ${ref.messageId}`,
    summary: `WhatsApp text from \`${ref.chatJid}\`.\n\n> ${excerpt}`,
    pointers: [],
  });

  const mediaIndexInsert: MediaIndexInsert = {
    source: "whatsapp",
    external_jid: `${ref.chatJid}/${ref.messageId}`,
    occurred_at: occurredAt.toISOString(),
    tags: ["whatsapp", "text"],
    warm_pack_path: warmPackPath,
    notes: "text-only; no supabase_object_path",
  };

  return { warmPackPath, warmMarkdown, mediaIndexInsert };
}

/**
 * Stub: build a drive_folders insert for a human folder purpose row.
 * Does not upload blobs to Drive. JT supplies folder_id + purpose when registering.
 */
export function linkDriveFolderPurpose(input: {
  folderId: string;
  name: string;
  purpose: string;
  contextpackPath?: string | null;
  parentFolderId?: string | null;
  staffId?: string | null;
  tags?: string[];
}): DriveFolderInsert {
  return {
    folder_id: input.folderId,
    name: input.name,
    purpose: input.purpose,
    contextpack_path: input.contextpackPath ?? null,
    parent_folder_id: input.parentFolderId ?? null,
    staff_id: input.staffId ?? null,
    tags: input.tags ?? [],
  };
}

/**
 * Helper for later CLI: write warm markdown to a repo-relative path.
 * This scaffold does not touch the filesystem when only building payloads;
 * pass a write fn when wiring a real runner.
 */
export async function writeWarmPack(
  writeFile: (path: string, contents: string) => Promise<void>,
  result: WaIngestResult,
): Promise<void> {
  await writeFile(result.warmPackPath, result.warmMarkdown);
}

/**
 * TODO: upload/replace bytes in Supabase Storage and return the durable version-store object path.
 * Needs SUPABASE_URL + service role. Do not use Drive as the version store; use it for contextual/organized placement.
 */
export async function uploadToSupabaseStorage(_opts: {
  localPath: string;
  objectPath: string;
}): Promise<string> {
  throw new Error(
    "TODO: uploadToSupabaseStorage — needs SUPABASE_URL + service role + bucket policy",
  );
}
