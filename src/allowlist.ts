import { parseChannelId, parseSlackChannelId, type ChannelId, type Surface } from "./domain.ts";

export type ChannelGrant = {
  surface: Surface;
  channelId: ChannelId;
  name: string;
};

const ALL_FRAN = parseSlackChannelId("C0C5GDWHBNX");
if (ALL_FRAN === null) throw new Error("bad all-fran channel id");

const IT_HELPDESK = parseSlackChannelId("C0C6J930A6L");
if (IT_HELPDESK === null) throw new Error("bad it-helpdesk channel id");

/** `#it-helpdesk`. Hardware issues raise only in this channel. */
export const IT_HELPDESK_CHANNEL_ID = IT_HELPDESK;

/** Code-owned base grants. CTO edits here for permanent channels. */
export const CHANNEL_ALLOWLIST: readonly ChannelGrant[] = [
  { surface: "slack", channelId: ALL_FRAN, name: "all-fran" },
  { surface: "slack", channelId: IT_HELPDESK, name: "it-helpdesk" },
];

/**
 * Parse JT-supplied extra Slack channels from env.
 * Format: `C012ABC:ops-floor,C012DEF:shift-lead` (comma or semicolon).
 * Name is optional (`C012ABC` alone → name `"extra"`). Invalid tokens skipped.
 */
export function parseExtraSlackChannelGrants(raw: string | undefined | null): ChannelGrant[] {
  if (raw === undefined || raw === null) return [];
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  const out: ChannelGrant[] = [];
  const seen = new Set<string>();
  for (const part of trimmed.split(/[,;]/)) {
    const token = part.trim();
    if (token.length === 0) continue;
    const colon = token.indexOf(":");
    const idPart = (colon === -1 ? token : token.slice(0, colon)).trim();
    const namePart = (colon === -1 ? "extra" : token.slice(colon + 1)).trim();
    const channelId = parseSlackChannelId(idPart);
    if (channelId === null) continue;
    if (seen.has(channelId)) continue;
    seen.add(channelId);
    const name = namePart.length > 0 ? namePart : "extra";
    out.push({ surface: "slack", channelId, name });
  }
  return out;
}

/** Merge code base grants with env extras. First grant for a channelId wins (code first). */
export function mergeChannelGrants(
  base: readonly ChannelGrant[],
  extras: readonly ChannelGrant[],
): ChannelGrant[] {
  const out: ChannelGrant[] = [];
  const seen = new Set<string>();
  for (const grant of [...base, ...extras]) {
    const key = `${grant.surface}:${grant.channelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(grant);
  }
  return out;
}


/**
 * Parse JT-supplied extra Telegram chats from env.
 * Format: `555100:ops-tg,555200:floor` (comma or semicolon).
 */
export function parseExtraTelegramChatGrants(raw: string | undefined | null): ChannelGrant[] {
  if (raw === undefined || raw === null) return [];
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  const out: ChannelGrant[] = [];
  const seen = new Set<string>();
  for (const part of trimmed.split(/[,;]/)) {
    const token = part.trim();
    if (token.length === 0) continue;
    const colon = token.indexOf(":");
    const idPart = (colon === -1 ? token : token.slice(0, colon)).trim();
    const namePart = (colon === -1 ? "extra" : token.slice(colon + 1)).trim();
    const channelId = parseChannelId(idPart);
    if (channelId === null) continue;
    if (seen.has(channelId)) continue;
    seen.add(channelId);
    out.push({ surface: "telegram", channelId, name: namePart.length > 0 ? namePart : "extra" });
  }
  return out;
}

/** Runtime allowlist: code base + `SLACK_EXTRA_CHANNELS` + `TELEGRAM_EXTRA_CHATS` (if set). */
export function loadChannelAllowlist(
  env: NodeJS.ProcessEnv = process.env,
  base: readonly ChannelGrant[] = CHANNEL_ALLOWLIST,
): readonly ChannelGrant[] {
  const extras = [
    ...parseExtraSlackChannelGrants(env.SLACK_EXTRA_CHANNELS),
    ...parseExtraTelegramChatGrants(env.TELEGRAM_EXTRA_CHATS),
  ];
  return mergeChannelGrants(base, extras);
}

export function findGrant(
  grants: readonly ChannelGrant[],
  surface: Surface,
  channelId: string,
): ChannelGrant | null {
  return grants.find((grant) => grant.surface === surface && grant.channelId === channelId) ?? null;
}
