/**
 * WhatsApp → warm pack + media_index payload stubs.
 * Does NOT upload to Drive or Slack. cold_uri is a placeholder until JT shares a Drive folder.
 */

import {
  assertNoBlobPayload,
  buildWarmPackMarkdown,
  placeholderColdUri,
  warmWaPackPath,
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
 * TODO: upload local media to Drive and set a real cold_uri (needs JT Drive folder/share).
 * TODO: optional post of a recent copy to an allowlisted Slack channel (needs #1 Slack install).
 */
export function ingestWaMedia(ref: WaMediaRef): WaIngestResult {
  assertNoBlobPayload(ref as unknown as Record<string, unknown>);
  const occurredAt = asDate(ref.occurredAt);
  const slug = slugFromMessage(ref.chatJid, ref.messageId);
  const warmPackPath = warmWaPackPath(occurredAt, slug);
  const coldUri = placeholderColdUri("whatsapp", `${ref.chatJid}/${ref.messageId}`);

  const summaryParts = [
    `WhatsApp ${ref.kind} from \`${ref.chatJid}\`.`,
    ref.caption ? `Caption: ${ref.caption.trim()}` : null,
    ref.localPath
      ? `Local path (not uploaded): \`${ref.localPath}\`.`
      : "No local path yet.",
    "Cold object: placeholder Drive URI until JT configures the cold folder.",
  ].filter(Boolean) as string[];

  const warmMarkdown = buildWarmPackMarkdown({
    title: `WA ${ref.kind} ${ref.messageId}`,
    summary: summaryParts.join(" "),
    pointers: [
      { label: "cold (pending)", uri: coldUri },
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
    cold_uri: coldUri,
    mime_hint: ref.mimeHint ?? null,
    bytes_hint: ref.bytesHint ?? null,
    notes: ref.localPath ? `localPath=${ref.localPath}` : null,
  };

  return { warmPackPath, warmMarkdown, mediaIndexInsert };
}

/**
 * Build a short warm pack for a WA text message (no cold blob expected).
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
    notes: "text-only; no cold_uri",
  };

  return { warmPackPath, warmMarkdown, mediaIndexInsert };
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
