/** WhatsApp message / media refs for wacli ingest stubs. No live WA session required. */

export type WaChatJid = string;
export type WaMessageId = string;

export type WaMediaKind = "image" | "video" | "audio" | "document" | "sticker" | "other";

export type WaMediaRef = {
  /** Chat JID (group or DM). */
  chatJid: WaChatJid;
  /** Message id within the chat. */
  messageId: WaMessageId;
  kind: WaMediaKind;
  mimeHint?: string;
  bytesHint?: number;
  /** Local path if already downloaded by an external tool; not uploaded in this scaffold. */
  localPath?: string;
  caption?: string;
  occurredAt: Date | string;
};

export type WaTextRef = {
  chatJid: WaChatJid;
  messageId: WaMessageId;
  text: string;
  occurredAt: Date | string;
};

export type WaIngestResult = {
  warmPackPath: string;
  warmMarkdown: string;
  mediaIndexInsert: import("../storage.ts").MediaIndexInsert;
};
