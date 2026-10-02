import { expect, test } from "bun:test";
import {
  classifyStaffIntent,
  classifyStaffIntentAsync,
  formatRouteReply,
  LLM_ROUTING_ENABLED,
  runToolStubs,
  shouldSkipRouting,
} from "../src/routing.ts";
import { isLlmRoutingEnabled } from "../src/llm.ts";

test("LLM routing compile stub stays false; env helper defaults off", () => {
  expect(LLM_ROUTING_ENABLED).toBe(false);
  expect(isLlmRoutingEnabled({})).toBe(false);
  expect(isLlmRoutingEnabled({ LLM_ROUTING_ENABLED: "true" })).toBe(true);
});

test("classifyStaffIntent is deterministic keyword routing", () => {
  expect(classifyStaffIntent({ text: "show me the roster for today" }).intent).toBe("hrm_roster");
  expect(classifyStaffIntent({ text: "where is the handbook sop?" }).intent).toBe("docs_index");
  expect(classifyStaffIntent({ text: "check sku inventory for serum" }).intent).toBe("skums_read");
  expect(classifyStaffIntent({ text: "pos sales today please" }).intent).toBe("pos_read");
  expect(classifyStaffIntent({ text: "please KIV this for Monday" }).intent).toBe("kiv");
  expect(classifyStaffIntent({ text: "need clarity on the promo" }).intent).toBe("ask");
  expect(classifyStaffIntent({ text: "escalate to manager now" }).intent).toBe("escalate");
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
  expect(formatRouteReply({ intent: "kiv", tools: [], usedLlm: true }, [])).toContain("kiv");
});

test("shouldSkipRouting leaves tell/templates/help alone", () => {
  expect(shouldSkipRouting("tell <@U0STAFF2> cover open")).toBe(true);
  expect(shouldSkipRouting("shift_open")).toBe(true);
  expect(shouldSkipRouting("help")).toBe(true);
  expect(shouldSkipRouting("whoami")).toBe(true);
  expect(shouldSkipRouting("show roster")).toBe(false);
});

test("classifyStaffIntentAsync uses xAI when enabled then maps intent", async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "pos_read" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const d = await classifyStaffIntentAsync(
    { text: "freeform about the till numbers" },
    { LLM_ROUTING_ENABLED: "true", XAI_API_KEY: "test-key", XAI_MODEL: "grok-test" },
    fakeFetch,
  );
  expect(d.intent).toBe("pos_read");
  expect(d.usedLlm).toBe(true);
  expect(d.tools).toEqual(["pos.read"]);
});

test("classifyStaffIntentAsync falls back to keywords when LLM fails", async () => {
  const fakeFetch = async () => new Response("nope", { status: 500 });
  const d = await classifyStaffIntentAsync(
    { text: "show me the roster" },
    { LLM_ROUTING_ENABLED: "true", XAI_API_KEY: "test-key" },
    fakeFetch,
  );
  expect(d.intent).toBe("hrm_roster");
  expect(d.usedLlm).toBe(false);
});
