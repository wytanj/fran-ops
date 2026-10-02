import { expect, test } from "bun:test";
import {
  classifyStaffIntent,
  formatRouteReply,
  LLM_ROUTING_ENABLED,
  runToolStubs,
  shouldSkipRouting,
} from "../src/routing.ts";

test("LLM routing gate is stubbed off", () => {
  expect(LLM_ROUTING_ENABLED).toBe(false);
});

test("classifyStaffIntent is deterministic keyword routing", () => {
  expect(classifyStaffIntent({ text: "show me the roster for today" }).intent).toBe("hrm_roster");
  expect(classifyStaffIntent({ text: "where is the handbook sop?" }).intent).toBe("docs_index");
  expect(classifyStaffIntent({ text: "check sku inventory for serum" }).intent).toBe("skums_read");
  expect(classifyStaffIntent({ text: "pos sales today please" }).intent).toBe("pos_read");
  expect(classifyStaffIntent({ text: "random chatter" }).intent).toBe("unknown");
});

test("thread texts contribute to intent", () => {
  const d = classifyStaffIntent({
    text: "@Franbird help with this",
    threadTexts: ["we need the roster for Bugis"],
  });
  expect(d.intent).toBe("hrm_roster");
  expect(d.tools).toEqual(["hrm.roster"]);
  expect(d.usedLlm).toBe(false);
});

test("runToolStubs never writes — stub status only", () => {
  const stubs = runToolStubs(["hrm.roster", "docs.index", "skums.read", "pos.read"]);
  expect(stubs).toHaveLength(4);
  for (const s of stubs) {
    expect(s.status).toBe("stub");
    expect(s.message.length).toBeGreaterThan(0);
  }
  const reply = formatRouteReply(
    { intent: "hrm_roster", tools: ["hrm.roster"], usedLlm: false },
    stubs.slice(0, 1),
  );
  expect(reply).toContain("hrm_roster");
  expect(reply).toContain("stubbed");
});

test("shouldSkipRouting leaves tell/templates/help alone", () => {
  expect(shouldSkipRouting("tell <@U0STAFF2> cover open")).toBe(true);
  expect(shouldSkipRouting("shift_open")).toBe(true);
  expect(shouldSkipRouting("help")).toBe(true);
  expect(shouldSkipRouting("whoami")).toBe(true);
  expect(shouldSkipRouting("show roster")).toBe(false);
});
