import { expect, test } from "bun:test";
import { classifyIntentWithXai, isLlmRoutingEnabled, loadXaiConfig } from "../src/llm.ts";

test("loadXaiConfig requires API key", () => {
  expect(loadXaiConfig({})).toBeNull();
  const cfg = loadXaiConfig({ XAI_API_KEY: "xk-test", XAI_MODEL: "grok-x" });
  expect(cfg).not.toBeNull();
  expect(cfg?.baseUrl).toBe("https://api.x.ai/v1");
  expect(cfg?.model).toBe("grok-x");
});

test("isLlmRoutingEnabled parses truthy strings", () => {
  expect(isLlmRoutingEnabled({ LLM_ROUTING_ENABLED: "yes" })).toBe(true);
  expect(isLlmRoutingEnabled({ LLM_ROUTING_ENABLED: "0" })).toBe(false);
});

test("classifyIntentWithXai parses single-token reply", async () => {
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toStartWith("Bearer ");
    return new Response(JSON.stringify({ choices: [{ message: { content: "kiv" } }] }), {
      status: 200,
    });
  };
  const intent = await classifyIntentWithXai(
    { text: "park this" },
    { apiKey: "k", baseUrl: "https://api.x.ai/v1", model: "m" },
    fakeFetch,
  );
  expect(intent).toBe("kiv");
});
