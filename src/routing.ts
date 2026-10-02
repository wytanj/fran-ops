/**
 * Staff-aware routing: deterministic keywords + optional xAI LLM gate.
 * staff_identities → intent → tool allowlist stubs / kiv|ask|escalate acks.
 * Writes remain approval-card only.
 */

import {
  classifyIntentWithXai,
  isLlmRoutingEnabled,
  loadXaiConfig,
  type FetchLike,
  type LlmIntent,
} from "./llm.ts";

export type StaffRouteIntent =
  | "hrm_roster"
  | "docs_index"
  | "skums_read"
  | "pos_read"
  | "kiv"
  | "ask"
  | "escalate"
  | "unknown";

export type ToolStubId =
  | "hrm.roster"
  | "docs.index"
  | "skums.read"
  | "pos.read";

export type ToolAllowlist = readonly ToolStubId[];

/** @deprecated Prefer isLlmRoutingEnabled(env). Kept false for sync keyword tests. */
export const LLM_ROUTING_ENABLED = false;

const INTENT_TOOLS: Record<Exclude<StaffRouteIntent, "unknown" | "kiv" | "ask" | "escalate">, ToolAllowlist> = {
  hrm_roster: ["hrm.roster"],
  docs_index: ["docs.index"],
  skums_read: ["skums.read"],
  pos_read: ["pos.read"],
};

const INTENT_PATTERNS: Array<{ intent: Exclude<StaffRouteIntent, "unknown">; re: RegExp }> = [
  { intent: "hrm_roster", re: /\b(roster|who'?s?\s+on|who\s+works|schedule|shift\s+staff|on[- ]duty)\b/i },
  { intent: "docs_index", re: /\b(docs?|handbook|polic(?:y|ies)|sop|playbook|runbook)\b/i },
  { intent: "skums_read", re: /\b(sku|skus|skums|inventory|stock\s+level|on[- ]hand)\b/i },
  { intent: "pos_read", re: /\b(pos|till|register|sales\s+today|transactions?)\b/i },
  { intent: "kiv", re: /\b(kiv|keep\s+in\s+view|park\s+this|note\s+for\s+later)\b/i },
  { intent: "ask", re: /\b(need\s+clarity|clarif(?:y|ication)|what\s+should\s+we|can\s+someone\s+advise)\b/i },
  { intent: "escalate", re: /\b(escalat(?:e|ion)|page\s+manager|needs?\s+manager)\b/i },
];

export type RouteInput = {
  text: string;
  /** Optional concatenated thread parent texts for keyword scan. */
  threadTexts?: readonly string[];
};

export type RouteDecision = {
  intent: StaffRouteIntent;
  tools: ToolAllowlist;
  /** True only if LLM gate ran and chose the intent. */
  usedLlm: boolean;
};

function decisionFromIntent(intent: StaffRouteIntent, usedLlm: boolean): RouteDecision {
  if (intent === "unknown" || intent === "kiv" || intent === "ask" || intent === "escalate") {
    return { intent, tools: [], usedLlm };
  }
  return { intent, tools: INTENT_TOOLS[intent], usedLlm };
}

function keywordClassify(input: RouteInput): RouteDecision {
  const blob = [input.text, ...(input.threadTexts ?? [])].join("\n");
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(blob)) {
      return decisionFromIntent(intent, false);
    }
  }
  return { intent: "unknown", tools: [], usedLlm: false };
}

/**
 * Deterministic intent from staff message (+ optional thread context).
 * Sync path: keywords only (LLM_ROUTING_ENABLED compile stub stays false).
 */
export function classifyStaffIntent(input: RouteInput): RouteDecision {
  return keywordClassify(input);
}

/**
 * Async classifier: when LLM_ROUTING_ENABLED + XAI_API_KEY, ask xAI first;
 * on failure / unknown from LLM, fall back to keywords. Never writes.
 */
export async function classifyStaffIntentAsync(
  input: RouteInput,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<RouteDecision> {
  if (isLlmRoutingEnabled(env)) {
    const cfg = loadXaiConfig(env);
    if (cfg !== null) {
      try {
        const llmIntent = await classifyIntentWithXai(input, cfg, fetchImpl);
        if (llmIntent !== null && llmIntent !== "unknown") {
          return decisionFromIntent(llmIntent as StaffRouteIntent, true);
        }
      } catch {
        // fall through to keywords
      }
    }
  }
  return keywordClassify(input);
}

export type ToolStubResult = {
  status: "stub";
  tool: ToolStubId;
  message: string;
};

const STUB_MESSAGES: Record<ToolStubId, string> = {
  "hrm.roster": "HRM roster read is stubbed — wire FranHRM roster API later.",
  "docs.index": "Docs index read is stubbed — wire docs search later.",
  "skums.read": "SKUMS/inventory read is stubbed — wire fran-skums reads later.",
  "pos.read": "POS read is stubbed — wire fran-pos reads later.",
};

/** Execute allowlisted read stubs only. Never writes / never auto-commits. */
export function runToolStubs(tools: ToolAllowlist): ToolStubResult[] {
  return tools.map((tool) => ({
    status: "stub" as const,
    tool,
    message: STUB_MESSAGES[tool],
  }));
}

const META_REPLIES: Record<"kiv" | "ask" | "escalate", string> = {
  kiv: "Routed intent `kiv` — kept in view. No write (approval-card only for commits).",
  ask: "Routed intent `ask` — needs a clarifying answer from staff. No auto write.",
  escalate:
    "Routed intent `escalate` — flag for manager. Use :rotating_light: on a task card to stamp; no auto write.",
};

export function formatRouteReply(decision: RouteDecision, stubs: ToolStubResult[]): string {
  if (decision.intent === "kiv" || decision.intent === "ask" || decision.intent === "escalate") {
    const gate = decision.usedLlm ? "LLM" : "deterministic";
    return `${META_REPLIES[decision.intent]} (${gate}).`;
  }
  if (decision.intent === "unknown" || stubs.length === 0) {
    return "";
  }
  const gate = decision.usedLlm ? "LLM" : "deterministic; keyword";
  const lines = stubs.map((s) => `• ${s.tool}: ${s.message}`);
  return [`Routed intent \`${decision.intent}\` (${gate}).`, ...lines].join("\n");
}

/** True when text looks like an existing template / tell / help command — skip routing. */
export function shouldSkipRouting(text: string): boolean {
  const t = text
    .replace(/^(?:\s*<@U[A-Z0-9]+(?:\|[^>]+)?>\s*)+/g, "")
    .replace(/^@?franbird\b[,:]?\s*/i, "")
    .replace(/^\/bird\s+/i, "")
    .trim();
  if (t.length === 0) return true;
  if (/^(help|whoami)\b/i.test(t)) return true;
  if (/^(?:please|pls|can you|could you|hey)\s+(?:tell|ask)\b/i.test(t)) return true;
  if (/^(?:tell|ask)\b/i.test(t)) return true;
  if (/^briefing\s*[=:]\s*(optional|required)\s+(?:tell|ask)\b/i.test(t)) return true;
  const first = t.split(/\s+/)[0]?.toLowerCase();
  if (
    first === "shift_open" ||
    first === "shift_close" ||
    first === "incident" ||
    first === "hand_off" ||
    first === "tell"
  ) {
    return true;
  }
  return false;
}

// re-export for callers that want env helpers alongside routing
export { isLlmRoutingEnabled, loadXaiConfig };
export type { LlmIntent };
