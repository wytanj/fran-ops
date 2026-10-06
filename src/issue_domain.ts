import { parseSlackUserId, type SlackUserId } from "./domain.ts";

declare const issueIdBrand: unique symbol;

export type IssueId = string & { readonly [issueIdBrand]: "IssueId" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ISSUE_PLAYBOOK = "hardware" as const;
export type IssuePlaybook = typeof ISSUE_PLAYBOOK;

export const ISSUE_STATUSES = [
  "open",
  "waiting_approve",
  "in_progress",
  "blocked",
  "done",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_ACTIONS = ["approve", "send_back"] as const;
export type IssueAction = (typeof ISSUE_ACTIONS)[number];

export const ISSUE_APPROVER_ENV = "ISSUE_APPROVER_SLACK_USER_ID";

export type IssueReason =
  | "channel_not_allowlisted"
  | "not_helpdesk"
  | "unknown_staff"
  | "not_approver"
  | "approver_unconfigured"
  | "no_photo"
  | "unknown_issue"
  | "bad_status"
  | "bad_payload";

export type IssueResult<T> = { ok: true; value: T } | { ok: false; reason: IssueReason };

export type PhotoRef = {
  slackFileId: string;
  url: string | null;
};

export type HardwarePayload = {
  device: string | null;
  site: string | null;
  dropHeightMm: number | null;
  caption: string | null;
  photoRefs: PhotoRef[];
};

export type EvidenceRef =
  | { kind: "slack_file"; slackFileId: string; url: string | null }
  | { kind: "slack_thread"; channelId: string; threadTs: string }
  | { kind: "note"; text: string; staffId: string }
  | {
      kind: "email_draft";
      template: "samsung_care_plus";
      to: string;
      subject: string;
      body: string;
      delivery: "outbox_ready";
    };

export function parseIssueId(raw: string): IssueId | null {
  if (!UUID_RE.test(raw)) return null;
  return raw.toLowerCase() as IssueId;
}

export function isIssueStatus(raw: string): raw is IssueStatus {
  for (const status of ISSUE_STATUSES) {
    if (status === raw) return true;
  }
  return false;
}

export function readIssueApproverSlackUserId(env: NodeJS.ProcessEnv): SlackUserId | null {
  const raw = env[ISSUE_APPROVER_ENV];
  if (typeof raw !== "string") return null;
  return parseSlackUserId(raw.trim());
}

export function nextIssueStatus(status: IssueStatus, action: IssueAction): IssueStatus | null {
  switch (action) {
    case "approve":
      return status === "waiting_approve" ? "in_progress" : null;
    case "send_back":
      return status === "waiting_approve" ? "blocked" : null;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function parsePhotoUrl(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export function normalizePhotoRef(input: { slackFileId: string; url: string | null }): PhotoRef | null {
  const slackFileId = input.slackFileId.trim();
  if (slackFileId.length === 0 || /\s/.test(slackFileId)) return null;
  return { slackFileId, url: parsePhotoUrl(input.url) };
}

const LABELS = "device|site|drop";

function readLabeled(text: string, label: string): string | null {
  const match = text.match(
    new RegExp(`(?:^|\\s)${label}\\s*[:=]\\s*(.+?)(?=\\s+(?:${LABELS})\\s*[:=]|$)`, "i"),
  );
  const value = match?.[1]?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function leadingInteger(raw: string | null): number | null {
  if (raw === null) return null;
  const match = raw.match(/(\d+)/);
  if (match?.[1] === undefined) return null;
  const n = Number(match[1]);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

export function parseHardwareCaption(raw: string): {
  device: string | null;
  site: string | null;
  dropHeightMm: number | null;
  caption: string | null;
} {
  const caption = raw.trim();
  const labeledDrop = leadingInteger(readLabeled(caption, "drop"));
  const bare = caption.match(/\b(\d+)\s*mm\b/i);
  const bareDrop = bare?.[1] === undefined ? null : Number(bare[1]);
  const dropHeightMm = labeledDrop ?? (bareDrop !== null && Number.isSafeInteger(bareDrop) ? bareDrop : null);
  return {
    device: readLabeled(caption, "device"),
    site: readLabeled(caption, "site"),
    dropHeightMm,
    caption: caption.length > 0 ? caption : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

export function readHardwarePayload(value: unknown): HardwarePayload | null {
  if (!isRecord(value)) return null;
  const device = readNullableString(value.device);
  const site = readNullableString(value.site);
  const caption = readNullableString(value.caption);
  if (device === undefined || site === undefined || caption === undefined) return null;
  if (!Array.isArray(value.photoRefs)) return null;
  let dropHeightMm: number | null;
  if (value.dropHeightMm === null) {
    dropHeightMm = null;
  } else if (
    typeof value.dropHeightMm === "number" &&
    Number.isSafeInteger(value.dropHeightMm) &&
    value.dropHeightMm >= 0
  ) {
    dropHeightMm = value.dropHeightMm;
  } else {
    return null;
  }
  const photoRefs: PhotoRef[] = [];
  for (const item of value.photoRefs) {
    if (!isRecord(item) || typeof item.slackFileId !== "string") return null;
    const url = readNullableString(item.url);
    if (url === undefined) return null;
    const photo = normalizePhotoRef({ slackFileId: item.slackFileId, url });
    if (photo === null) return null;
    photoRefs.push(photo);
  }
  return { device, site, dropHeightMm, caption, photoRefs };
}

export function hardwareCarePlusDraft(input: {
  issueId: string;
  payload: HardwarePayload;
}): { to: string; subject: string; body: string } {
  const device = input.payload.device ?? "unknown";
  const site = input.payload.site ?? "unknown";
  const drop = input.payload.dropHeightMm === null ? "unknown" : `${input.payload.dropHeightMm} mm`;
  const photoLines =
    input.payload.photoRefs.length === 0
      ? "- none"
      : input.payload.photoRefs
          .map((photo) => (photo.url === null ? `- ${photo.slackFileId}` : `- ${photo.slackFileId} ${photo.url}`))
          .join("\n");
  return {
    to: "Samsung Care+",
    subject: `Care+ claim ${device} at ${site}`,
    body: [
      `Device: ${device}`,
      `Site: ${site}`,
      `Drop height: ${drop}`,
      `Issue: ${input.issueId}`,
      "Photos:",
      photoLines,
      "",
      "This draft was not sent.",
    ].join("\n"),
  };
}
