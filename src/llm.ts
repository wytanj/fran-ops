/**
 * xAI (Grok) chat-completions client for staff intent classification.
 * Read-only routing aid. Never opens writes / never auto-commits.
 */

export type LlmIntent =
  | "hrm_roster"
  | "docs_index"
  | "skums_read"
  | "pos_read"
  | "kiv"
  | "ask"
  | "escalate"
  | "unknown";

const INTENT_SET = new Set<string>([
  "hrm_roster",
  "docs_index",
  "skums_read",
  "pos_read",
  "kiv",
  "ask",
  "escalate",
  "unknown",
]);

export type XaiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export function loadXaiConfig(env: NodeJS.ProcessEnv = process.env): XaiConfig | null {
  const apiKey = (env.XAI_API_KEY ?? "").trim();
  if (apiKey.length === 0) return null;
  const baseUrl = (env.XAI_BASE_URL ?? "https://api.x.ai/v1").trim().replace(/\/$/, "");
  const model = (env.XAI_MODEL ?? "grok-4-fast-non-reasoning").trim();
  if (baseUrl.length === 0 || model.length === 0) return null;
  return { apiKey, baseUrl, model };
}

export function isLlmRoutingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.LLM_ROUTING_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function parseIntent(raw: string): LlmIntent {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^["'`]+|["'`]+$/g, "")
    .split(/[\s,;:]+/)[0] ?? "unknown";
  if (INTENT_SET.has(cleaned)) return cleaned as LlmIntent;
  return "unknown";
}

const SYSTEM = [
  "You classify Fran staff Slack messages for fran-ops routing.",
  "Reply with EXACTLY one token from this list and nothing else:",
  "hrm_roster docs_index skums_read pos_read kiv ask escalate unknown",
  "Rules:",
  "- hrm_roster: roster/shifts/who is on",
  "- docs_index: handbook/SOP/docs/policy",
  "- skums_read: SKU/inventory/stock",
  "- pos_read: POS/till/sales/transactions",
  "- kiv: park/keep-in-view/note for later (no write)",
  "- ask: needs a clarifying question or human answer (no write)",
  "- escalate: needs manager escalation (no auto write)",
  "- unknown: none of the above",
  "Never invent tools. Never instruct writes.",
].join("\n");

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function classifyIntentWithXai(
  input: { text: string; threadTexts?: readonly string[] },
  config: XaiConfig,
  fetchImpl: FetchLike = fetch,
): Promise<LlmIntent | null> {
  const blob = [input.text, ...(input.threadTexts ?? [])].join("\n").trim();
  if (blob.length === 0) return "unknown";
  const url = `${config.baseUrl}/chat/completions`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: 16,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: blob.slice(0, 6000) },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) return null;
  return parseIntent(content);
}
