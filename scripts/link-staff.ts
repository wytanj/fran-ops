/**
 * Ops CLI: link Slack user / display name on staff_identities.
 * Requires DATABASE_URL. Does not print connection strings or other secrets.
 *
 *   bun scripts/link-staff.ts --staff-id <uuid> --slack-user U… --employment full_time [--display-name Name]
 *   bun scripts/link-staff.ts --staff-id <uuid> --display-name Name
 *   bun scripts/link-staff.ts --list
 */
import { linkSlackUser, listStaffIdentities, setStaffDisplayName } from "../src/bus.ts";
import { pgDb } from "../src/db.ts";
import { parseSlackUserId, parseStaffId, type Employment } from "../src/domain.ts";

function usage(): never {
  console.error(`Usage:
  bun scripts/link-staff.ts --staff-id <uuid> --slack-user U… --employment full_time|part_time [--display-name Name]
  bun scripts/link-staff.ts --staff-id <uuid> --display-name Name
  bun scripts/link-staff.ts --list`);
  process.exit(2);
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function employmentOf(raw: string | undefined): Employment | null {
  if (raw === "full_time" || raw === "part_time") return raw;
  return null;
}

if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (databaseUrl === "") {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const db = pgDb(databaseUrl);

  if (has("--list")) {
    const rows = await listStaffIdentities(db);
    for (const row of rows) {
      console.log(
        [
          row.staffId,
          row.employment,
          row.displayName ?? "-",
          row.slackUserId ?? "-",
          row.telegramUserId ?? "-",
        ].join("\t"),
      );
    }
    process.exit(0);
  }

  const staffRaw = arg("--staff-id");
  const slackRaw = arg("--slack-user");
  const employmentRaw = arg("--employment");
  const displayRaw = arg("--display-name");
  if (staffRaw === undefined) usage();
  const staffId = parseStaffId(staffRaw);
  if (staffId === null) {
    console.error("bad --staff-id (need uuid)");
    process.exit(1);
  }

  if (slackRaw !== undefined) {
    const slackUserId = parseSlackUserId(slackRaw);
    const employment = employmentOf(employmentRaw);
    if (slackUserId === null) {
      console.error("bad --slack-user (need U…)");
      process.exit(1);
    }
    if (employment === null) {
      console.error("--employment full_time|part_time required with --slack-user");
      process.exit(1);
    }
    await linkSlackUser(db, {
      staffId,
      employment,
      slackUserId,
      displayName: displayRaw,
    });
    console.log(`linked slack ${slackUserId} -> ${staffId}`);
    process.exit(0);
  }

  if (displayRaw !== undefined) {
    const ok = await setStaffDisplayName(db, staffId, displayRaw);
    if (!ok) {
      console.error("staff_id not found");
      process.exit(1);
    }
    console.log(`display_name set for ${staffId}`);
    process.exit(0);
  }

  usage();
}
