import type { ChannelId, Surface } from "./domain.ts";

export type ChannelGrant = {
  surface: Surface;
  channelId: ChannelId;
  name: string;
};

export const CHANNEL_ALLOWLIST: readonly ChannelGrant[] = [];

export function findGrant(
  grants: readonly ChannelGrant[],
  surface: Surface,
  channelId: string,
): ChannelGrant | null {
  return grants.find((grant) => grant.surface === surface && grant.channelId === channelId) ?? null;
}
