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

export const TASK_TEMPLATE_KEYS = ["shift_open", "shift_close", "incident", "hand_off", "tell"] as const;
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

export const CARD_TEMPLATES = ["draft_for_approve", "ack", "dm_ack"] as const;
export type CardTemplate = (typeof CARD_TEMPLATES)[number];

export const OUTBOX_STATUSES = ["pending", "publishing", "published", "failed"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const TASK_TEMPLATES: Record<TaskTemplateKey, { title: string }> = {
  shift_open: { title: "Open shift" },
  shift_close: { title: "Close shift" },
  incident: { title: "Incident" },
  hand_off: { title: "Hand off" },
  tell: { title: "Franbird tell" },
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

export type BriefingMode = "optional" | "required";

export type BusReason =
  | "unknown_template"
  | "free_text"
  | "channel_not_allowlisted"
  | "unknown_staff"
  | "bad_payload"
  | "no_task"
  | "unknown_task"
  | "unknown_assignee"
  | "bad_franbird";

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

export function parseChannelId(raw: string): ChannelId | null {
  if (raw.length === 0 || raw !== raw.trim()) return null;
  return raw as ChannelId;
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
  if (key === undefined || !isTaskTemplateKey(key)) return { ok: false, reason: "unknown_template" };
  if (parts.length > 1) return { ok: false, reason: "free_text" };
  return { ok: true, value: { templateKey: key } };
}

export function formatStaffLabel(input: {
  staffId: string;
  displayName?: string | null;
  slackUserId?: string | null;
}): string {
  const name = input.displayName?.trim();
  if (name !== undefined && name.length > 0) return name;
  const slack = input.slackUserId?.trim();
  if (slack !== undefined && slack.length > 0) return `<@${slack}>`;
  const id = input.staffId.trim().toLowerCase();
  if (UUID_RE.test(id)) return id.slice(0, 8);
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function parseFranbirdTell(text: string): Result<{
  assigneeSlackUserId: SlackUserId;
  body: string;
  briefing: BriefingMode;
}> {
  let t = text.replace(/^(?:\s*<@U[A-Z0-9]+(?:\|[^>]+)?>\s*)+/g, "").trim();
  t = t.replace(/^@?franbird\b[,:]?\s*/i, "").trim();
  t = t.replace(/^(?:please|pls|can you|could you|hey)\s+/i, "").trim();

  let briefing: BriefingMode = "optional";
  const prefixBrief = t.match(/^briefing\s*[=:]\s*(optional|required)\s+/i);
  if (prefixBrief !== null && prefixBrief[1] !== undefined) {
    briefing = prefixBrief[1].toLowerCase() === "required" ? "required" : "optional";
    t = t.slice(prefixBrief[0].length).trim();
  }

  const verb = t.match(/^(?:tell|ask)\s+/i);
  if (verb === null) return { ok: false, reason: "bad_franbird" };
  t = t.slice(verb[0].length).trim();

  const assigneeMatch =
    t.match(/^<@(U[A-Z0-9]+)(?:\|[^>]+)?>\s*/) ?? t.match(/^(U[A-Z0-9]{2,})\s+/);
  if (assigneeMatch === null || assigneeMatch[1] === undefined) {
    return { ok: false, reason: "bad_franbird" };
  }
  const assigneeSlackUserId = parseSlackUserId(assigneeMatch[1]);
  if (assigneeSlackUserId === null) return { ok: false, reason: "bad_franbird" };
  t = t.slice(assigneeMatch[0].length).trim();
  t = t.replace(/^(?:to|:)\s+/i, "").trim();

  const trailBrief = t.match(
    /\s+(?:briefing\s*[=:\s]\s*|\(briefing\s+)(optional|required)\)?\s*$/i,
  );
  if (trailBrief !== null && trailBrief[1] !== undefined) {
    briefing = trailBrief[1].toLowerCase() === "required" ? "required" : "optional";
    t = t.slice(0, trailBrief.index).trim();
  }

  const body = t.trim();
  if (body.length === 0) return { ok: false, reason: "bad_franbird" };
  return { ok: true, value: { assigneeSlackUserId, body, briefing } };
}


export function birdCommandHelp(): string {
  const templates = TASK_TEMPLATE_KEYS.filter((k) => k !== "tell").join(", ");
  return [
    "Franbird — /bird",
    `Templates: ${templates}`,
    "Tell: tell <@user> <message> [briefing=optional|required]",
    "Also: ask/please/can you…; bare U… ids ok in /bird; /bird help",
  ].join("\n");
}

export function stampForReaction(emoji: string): StampKind | null {
  return REACTION_TO_STAMP[emoji] ?? null;
}