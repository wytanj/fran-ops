import { expect, test } from "bun:test";
import {
  CHANNEL_ALLOWLIST,
  IT_HELPDESK_CHANNEL_ID,
  loadChannelAllowlist,
  mergeChannelGrants,
  parseExtraSlackChannelGrants,
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
