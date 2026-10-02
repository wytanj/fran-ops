/**
 * Staff-aware routing scaffold (deterministic).
 * staff_identities → intent → tool allowlist stubs.
 * LLM gate is stubbed OFF. Writes remain approval-card only.
 */

export type StaffRouteIntent =
  | "hrm_roster"
  | "docs_index"
  | "skums_read"
  | "pos_read"
  | "unknown";

export type ToolStubId =
  | "hrm.roster"
  | "docs.index"
  | "skums.read"
  | "pos.read";

export type ToolAllowlist = readonly ToolStubId[];

/** LLM classification gate — stubbed off; routing is keyword-only. */
export const LLM_ROUTING_ENABLED = false;

const INTENT_TOOLS: Record<Exclude<StaffRouteIntent, "unknown">, ToolAllowlist> = {
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
];

export type RouteInput = {
  text: string;
  /** Optional concatenated thread parent texts for keyword scan. */
  threadTexts?: readonly string[];
};

export type RouteDecision = {
  intent: StaffRouteIntent;
  tools: ToolAllowlist;
  /** True only if LLM_ROUTING_ENABLED and LLM chose; always false while stubbed off. */
  usedLlm: boolean;
};

/**
 * Deterministic intent from staff message (+ optional thread context).
 * First matching pattern wins. Never calls an LLM while LLM_ROUTING_ENABLED is false.
 */
export function classifyStaffIntent(input: RouteInput): RouteDecision {
  const blob = [input.text, ...(input.threadTexts ?? [])].join("\n");
  if (LLM_ROUTING_ENABLED) {
    // Stub: real LLM path not wired. Fall through to keywords.
  }
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(blob)) {
      return { intent, tools: INTENT_TOOLS[intent], usedLlm: false };
    }
  }
  return { intent: "unknown", tools: [], usedLlm: false };
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

export function formatRouteReply(decision: RouteDecision, stubs: ToolStubResult[]): string {
  if (decision.intent === "unknown" || stubs.length === 0) {
    return "";
  }
  const lines = stubs.map((s) => `• ${s.tool}: ${s.message}`);
  return [`Routed intent \`${decision.intent}\` (deterministic; LLM gate off).`, ...lines].join("\n");
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
