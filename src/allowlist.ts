import { parseSlackChannelId, type ChannelId, type Surface } from "./domain.ts";

export type ChannelGrant = {
  surface: Surface;
  channelId: ChannelId;
  name: string;
};

const ALL_FRAN = parseSlackChannelId("C0C5GDWHBNX");
if (ALL_FRAN === null) throw new Error("bad all-fran channel id");

export const CHANNEL_ALLOWLIST: readonly ChannelGrant[] = [
  { surface: "slack", channelId: ALL_FRAN, name: "all-fran" },
];

export function findGrant(
  grants: readonly ChannelGrant[],
  surface: Surface,
  channelId: string,
): ChannelGrant | null {
  return grants.find((grant) => grant.surface === surface && grant.channelId === channelId) ?? null;
}