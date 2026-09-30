declare const staffIdBrand: unique symbol;
declare const slackUserIdBrand: unique symbol;
declare const telegramUserIdBrand: unique symbol;
declare const channelIdBrand: unique symbol;
declare const taskIdBrand: unique symbol;

export type StaffId = string & { readonly [staffIdBrand]: "StaffId" };
export type SlackUserId = string & { readonly [slackUserIdBrand]: "SlackUserId" };
export type TelegramUserId = string & { readonly [telegramUserIdBrand]: "TelegramUserId" };
export type ChannelId = string & { readonly [channelIdBrand]: "ChannelId" };
export type TaskId = string & { readonly [taskIdBrand]: "TaskId" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EVENT_TYPES = [
  "channel.message",
  "task.opened",
  "stamp.applied",
  "card.approved",
  "card.sent_back",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const SURFACES = ["slack", "telegram"] as const;
export type Surface = (typeof SURFACES)[number];

export const EMPLOYMENTS = ["full_time", "part_time"] as const;
export type Employment = (typeof EMPLOYMENTS)[number];

export const STAMP_KINDS = ["claim", "done", "blocked", "hand_off", "escalate"] as const;
export type StampKind = (typeof STAMP_KINDS)[number];

export const TASK_TEMPLATE_KEYS = ["shift_open", "shift_close", "incident", "hand_off"] as const;
export type TaskTemplateKey = (typeof TASK_TEMPLATE_KEYS)[number];

export const TASK_STATUSES = [
  "open",
  "claimed",
  "blocked",
  "done",
  "handed_off",
  "escalated",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CARD_TEMPLATES = ["draft_for_approve"] as const;
export type CardTemplate = (typeof CARD_TEMPLATES)[number];

export const OUTBOX_STATUSES = ["pending", "publishing", "published", "failed"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const TASK_TEMPLATES: Record<TaskTemplateKey, { title: string }> = {
  shift_open: { title: "Open shift" },
  shift_close: { title: "Close shift" },
  incident: { title: "Incident" },
  hand_off: { title: "Hand off" },
};

export const STAMP_TO_STATUS: Record<StampKind, TaskStatus> = {
  claim: "claimed",
  done: "done",
  blocked: "blocked",
  hand_off: "handed_off",
  escalate: "escalated",
};

export const REACTION_TO_STAMP: Record<string, StampKind> = {
  eyes: "claim",
  white_check_mark: "done",
  no_entry_sign: "blocked",
  handshake: "hand_off",
  rotating_light: "escalate",
};

export type BusReason =
  | "unknown_template"
  | "free_text"
  | "channel_not_allowlisted"
  | "unknown_staff"
  | "bad_payload"
  | "no_task"
  | "unknown_task";

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; reason: BusReason };
export type Result<T> = Ok<T> | Err;

export function parseStaffId(raw: string): StaffId | null {
  if (!UUID_RE.test(raw)) return null;
  return raw.toLowerCase() as StaffId;
}

export function parseTaskId(raw: string): TaskId | null {
  if (!UUID_RE.test(raw)) return null;
  return raw.toLowerCase() as TaskId;
}

export function parseSlackUserId(raw: string): SlackUserId | null {
  if (!/^U[A-Z0-9]{2,}$/.test(raw)) return null;
  return raw as SlackUserId;
}

export function parseTelegramUserId(raw: string): TelegramUserId | null {
  if (!/^[0-9]{3,}$/.test(raw)) return null;
  return raw as TelegramUserId;
}

export function parseSlackChannelId(raw: string): ChannelId | null {
  if (!/^[CG][A-Z0-9]{2,}$/.test(raw)) return null;
  return raw as ChannelId;
}

export function isTaskTemplateKey(raw: string): raw is TaskTemplateKey {
  return (TASK_TEMPLATE_KEYS as readonly string[]).includes(raw);
}

export function parseFranText(text: string): Result<{ templateKey: TaskTemplateKey }> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: "unknown_template" };
  const parts = trimmed.split(/\s+/);
  const key = parts[0];
  if (key === undefined) return { ok: false, reason: "unknown_template" };
  if (parts.length > 1) return { ok: false, reason: "free_text" };
  if (!isTaskTemplateKey(key)) return { ok: false, reason: "unknown_template" };
  return { ok: true, value: { templateKey: key } };
}

export function stampForReaction(emoji: string): StampKind | null {
  return REACTION_TO_STAMP[emoji] ?? null;
}
