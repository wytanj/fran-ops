import type { ChannelId, Surface } from "./domain.ts";

export type ChannelGrant = {
  surface: Surface;
  channelId: ChannelId;
  name: string;
};

// Closed list. An empty array allows no channel. Add a grant in this file.
export const CHANNEL_ALLOWLIST: readonly ChannelGrant[] = [];

export function findGrant(
  grants: readonly ChannelGrant[],
  surface: Surface,
  channelId: string,
): ChannelGrant | null {
  return grants.find((grant) => grant.surface === surface && grant.channelId === channelId) ?? null;
}
