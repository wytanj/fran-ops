import { expect, test } from "bun:test";
import {
  findAssetBySerial,
  readAssetHistory,
  recordBotEvent,
  type AssetId,
} from "../src/asset_log.ts";
import { freshDb } from "./harness.ts";

const SERIAL = "R5GL855Q7PD";

async function assetIdOf(db: Awaited<ReturnType<typeof freshDb>>): Promise<AssetId> {
  const assetId = await findAssetBySerial(db, SERIAL);
  if (assetId === null) throw new Error("missing asset");
  return assetId;
}

test("crack, claim_filed, and oow stay readable and the asset row stays", async () => {
  const db = await freshDb();
  const steps = ["crack", "claim_filed", "oow"] as const;
  const ids: string[] = [];
  for (const eventType of steps) {
    const recorded = await recordBotEvent(db, {
      serial: SERIAL,
      kind: "mirror",
      site: "Bugis+ mirror tablet",
      eventType,
      issueId: null,
      idempotencyKey: `s10b:${eventType}`,
      payload: {},
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) throw new Error("record failed");
    expect(recorded.value.created).toBe(true);
  }
  const assetId = await assetIdOf(db);
  const history = await readAssetHistory(db, assetId);
  expect(history.map((event) => event.eventType)).toEqual(["crack", "claim_filed", "oow"]);
  expect(history.every((event) => event.actor === "bot" && event.assetId === assetId)).toBe(true);
  ids.push(...history.map((event) => event.id));

  const again = await recordBotEvent(db, {
    serial: SERIAL,
    kind: "mirror",
    site: "somewhere else",
    eventType: "oow",
    issueId: null,
    idempotencyKey: "s10b:oow",
    payload: {},
  });
  expect(again).toEqual({ ok: true, value: { assetId, created: false } });

  const assets = await db.query<{ kind: string; serial: string; site: string }>(
    `select kind, serial, site from assets where id = $1`,
    [assetId],
  );
  expect(assets).toEqual([{ kind: "mirror", serial: SERIAL, site: "Bugis+ mirror tablet" }]);
  const assetCount = await db.query<{ n: string }>(`select count(*)::text as n from assets`);
  expect(assetCount[0]?.n).toBe("1");

  await expect(db.query(`update asset_events set payload = '{"purged":true}'::jsonb where asset_id = $1`, [assetId])).rejects.toThrow();
  await expect(db.query(`delete from asset_events where asset_id = $1`, [assetId])).rejects.toThrow();
  await expect(db.query(`update assets set notes = 'gone' where id = $1`, [assetId])).rejects.toThrow();
  await expect(db.query(`delete from assets where id = $1`, [assetId])).rejects.toThrow();

  const survived = await readAssetHistory(db, assetId);
  expect(survived.map((event) => event.eventType)).toEqual(["crack", "claim_filed", "oow"]);
  expect(survived.map((event) => event.id)).toEqual(ids);
});

test("repair, swap, and retire remain after a later oow", async () => {
  const db = await freshDb();
  for (const eventType of ["repair", "swap", "retire", "oow"] as const) {
    const recorded = await recordBotEvent(db, {
      serial: SERIAL,
      kind: "mirror",
      site: null,
      eventType,
      issueId: null,
      idempotencyKey: `life:${eventType}`,
      payload: {},
    });
    expect(recorded.ok).toBe(true);
  }
  const history = await readAssetHistory(db, await assetIdOf(db));
  expect(history.map((event) => event.eventType)).toEqual(["repair", "swap", "retire", "oow"]);
});

test("the log rejects an unknown event type and a human actor, and still stores staff", async () => {
  const db = await freshDb();
  const recorded = await recordBotEvent(db, {
    serial: SERIAL,
    kind: "mirror",
    site: null,
    eventType: "crack",
    issueId: null,
    idempotencyKey: "s10b:crack",
    payload: {},
  });
  if (!recorded.ok) throw new Error("record failed");
  const assetId = recorded.value.assetId;
  await expect(
    db.query(
      `insert into asset_events (asset_id, event_type, actor, idempotency_key)
       values ($1, 'purge', 'bot', 'purge-1')`,
      [assetId],
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      `insert into asset_events (asset_id, event_type, actor, idempotency_key)
       values ($1, 'oow', 'human', 'human-1')`,
      [assetId],
    ),
  ).rejects.toThrow();
  const staff = await db.query<{ actor: string }>(
    `insert into asset_events (asset_id, event_type, actor, idempotency_key)
     values ($1, 'repair', 'staff', 'staff-1')
     returning actor`,
    [assetId],
  );
  expect(staff[0]?.actor).toBe("staff");
  const history = await readAssetHistory(db, assetId);
  expect(history.map((event) => event.actor)).toEqual(["bot", "staff"]);
  await expect(
    recordBotEvent(db, {
      serial: "has space",
      kind: "mirror",
      site: null,
      eventType: "oow",
      issueId: null,
      idempotencyKey: "bad-serial",
      payload: {},
    }),
  ).resolves.toEqual({ ok: false, reason: "bad_serial" });
});
