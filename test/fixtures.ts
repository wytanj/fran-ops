import type { ChannelGrant } from "../src/allowlist.ts";
import {
  parseChannelId,
  parseSlackChannelId,
  parseSlackUserId,
  parseStaffId,
  parseTelegramUserId,
} from "../src/domain.ts";

function must<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(label);
  return value;
}

export const staffA = must(parseStaffId("11111111-1111-4111-8111-111111111111"), "staffA");
export const staffB = must(parseStaffId("22222222-2222-4222-8222-222222222222"), "staffB");
export const slackUser = must(parseSlackUserId("U0STAFF01"), "slack user");
export const telegramUser = must(parseTelegramUserId("555001"), "telegram user");
export const slackChannel = must(parseSlackChannelId("C0OPS01"), "slack channel");
export const telegramChannel = must(parseChannelId("555100"), "telegram channel");

export const slackGrants: readonly ChannelGrant[] = [
  { surface: "slack", channelId: slackChannel, name: "ops" },
];

export const telegramGrants: readonly ChannelGrant[] = [
  { surface: "telegram", channelId: telegramChannel, name: "ops-tg" },
];
