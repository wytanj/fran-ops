import { expect, test } from "bun:test";
import {
  findStaffById,
  linkSlackUser,
  linkStaff,
  listStaffIdentities,
  setStaffDisplayName,
} from "../src/bus.ts";
import { parseSlackUserId } from "../src/domain.ts";
import { freshDb } from "./harness.ts";
import { slackUser, staffA, staffB, telegramUser } from "./fixtures.ts";

const otherSlack = parseSlackUserId("U0OTHER01");
if (otherSlack === null) throw new Error("other slack");

test("linkSlackUser does not wipe telegram_user_id on update", async () => {
  const db = await freshDb();
  await linkStaff(db, {
    staffId: staffA,
    employment: "full_time",
    slackUserId: slackUser,
    telegramUserId: telegramUser,
    displayName: "Jeremy",
  });
  await linkSlackUser(db, {
    staffId: staffA,
    employment: "full_time",
    slackUserId: otherSlack,
    displayName: "Jeremy T",
  });
  const row = await findStaffById(db, staffA);
  expect(row?.slackUserId).toBe(otherSlack);
  expect(row?.telegramUserId).toBe(telegramUser);
  expect(row?.displayName).toBe("Jeremy T");
});

test("setStaffDisplayName and listStaffIdentities", async () => {
  const db = await freshDb();
  await linkSlackUser(db, {
    staffId: staffB,
    employment: "part_time",
    slackUserId: otherSlack,
  });
  expect(await setStaffDisplayName(db, staffB, "Alice")).toBe(true);
  expect(await setStaffDisplayName(db, staffA, "Nope")).toBe(false);
  const listed = await listStaffIdentities(db);
  expect(listed.some((r) => r.staffId === staffB && r.displayName === "Alice")).toBe(true);
});
