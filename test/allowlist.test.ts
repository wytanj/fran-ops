import { expect, test } from "bun:test";
import {
  CHANNEL_ALLOWLIST,
  IT_HELPDESK_CHANNEL_ID,
  findGrant,
  grantsWithInbound,
  loadChannelAllowlist,
  mergeChannelGrants,
  parseExtraSlackChannelGrants,
  resolveInboundGrant,
  slackListenAllEnabled,
} from "../src/allowlist.ts";
import { parseSlackChannelId } from "../src/domain.ts";

test("parseExtraSlackChannelGrants skips invalid and accepts C…:name", () => {
  const a = parseSlackChannelId("C0EXTRA01");
  const b = parseSlackChannelId("C0EXTRA02");
  if (a === null || b === null) throw new Error("fixture channel ids");
  const grants = parseExtraSlackChannelGrants("C0EXTRA01:ops-floor; bogon, C0EXTRA02");
  expect(grants).toHaveLength(2);
  expect(grants[0]?.channelId).toBe(a);
  expect(grants[0]?.name).toBe("ops-floor");
  expect(grants[1]?.channelId).toBe(b);
  expect(grants[1]?.name).toBe("extra");
  expect(parseExtraSlackChannelGrants("")).toEqual([]);
  expect(parseExtraSlackChannelGrants(undefined)).toEqual([]);
});

test("loadChannelAllowlist merges env extras without inventing ids; code wins", () => {
  const loaded = loadChannelAllowlist({ SLACK_EXTRA_CHANNELS: "C0EXTRA01:floor" });
  const extra = parseSlackChannelId("C0EXTRA01");
  if (extra === null) throw new Error("extra");
  expect(loaded.some((g) => g.channelId === extra)).toBe(true);
  expect(loaded.length).toBeGreaterThanOrEqual(CHANNEL_ALLOWLIST.length + 1);

  const allFran = CHANNEL_ALLOWLIST[0]?.channelId;
  expect(allFran).toBeTruthy();
  const codeWins = mergeChannelGrants(CHANNEL_ALLOWLIST, [
    { surface: "slack", channelId: allFran!, name: "renamed-should-not-win" },
  ]);
  expect(codeWins.find((g) => g.channelId === allFran)?.name).toBe("all-fran");
});

test("it-helpdesk is a code grant", () => {
  const grant = CHANNEL_ALLOWLIST.find((row) => row.channelId === IT_HELPDESK_CHANNEL_ID);
  expect(grant).toEqual({ surface: "slack", channelId: IT_HELPDESK_CHANNEL_ID, name: "it-helpdesk" });
  expect(`${IT_HELPDESK_CHANNEL_ID}`).toBe("C0C6J930A6L");
});

test("parseSlackChannelId rejects placeholders", () => {
  expect(parseSlackChannelId("CHANNEL_ID_HERE")).toBeNull();
  expect(parseSlackChannelId("C0C5GDWHBNX")).not.toBeNull();
});

test("slackListenAllEnabled accepts truthy tokens", () => {
  expect(slackListenAllEnabled({ SLACK_LISTEN_ALL: "true" })).toBe(true);
  expect(slackListenAllEnabled({ SLACK_LISTEN_ALL: "1" })).toBe(true);
  expect(slackListenAllEnabled({ SLACK_LISTEN_ALL: "yes" })).toBe(true);
  expect(slackListenAllEnabled({ SLACK_LISTEN_ALL: "on" })).toBe(true);
  expect(slackListenAllEnabled({ SLACK_LISTEN_ALL: "false" })).toBe(false);
  expect(slackListenAllEnabled({})).toBe(false);
});

test("resolveInboundGrant synthesizes only for slack when listen-all on", () => {
  const other = parseSlackChannelId("C0LISTEN01");
  if (other === null) throw new Error("fixture");
  const env = { SLACK_LISTEN_ALL: "true" };
  expect(findGrant(CHANNEL_ALLOWLIST, "slack", other)).toBeNull();
  const grant = resolveInboundGrant(CHANNEL_ALLOWLIST, "slack", other, env);
  expect(grant).not.toBeNull();
  expect(grant!).toEqual({ surface: "slack", channelId: other, name: `listen:${other}` });
  expect(resolveInboundGrant(CHANNEL_ALLOWLIST, "slack", other, {})).toBeNull();
  const packed = grantsWithInbound(CHANNEL_ALLOWLIST, "slack", other, env);
  expect(packed).not.toBeNull();
  expect(packed!.grant).toEqual(grant!);
  expect(packed!.grants.some((g) => g.channelId === other)).toBe(true);
  // Existing allowlist channel returns original grants list.
  const known = CHANNEL_ALLOWLIST[0]!;
  const knownPacked = grantsWithInbound(CHANNEL_ALLOWLIST, "slack", known.channelId, env);
  expect(knownPacked?.grants).toBe(CHANNEL_ALLOWLIST);
});
