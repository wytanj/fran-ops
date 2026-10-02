/**
 * Receipt image extract via xAI (optional). Pointer-only; never auto-commits.
 * Caller stores URI in media_index / bill_expenses.receipt_uri, then shows confirm card.
 */

import { parseMoneyToCents } from "./bill_domain.ts";
import { isLlmRoutingEnabled, loadXaiConfig, type FetchLike, type XaiConfig } from "./llm.ts";

export type ReceiptExtract = {
  amountCents: number | null;
  merchant: string | null;
  currency: string;
  confidence: "high" | "ambiguous";
  raw: string;
};

const SYSTEM = [
  "Extract receipt total and merchant from the user text (OCR or caption).",
  "Reply with ONE JSON object only, no markdown:",
  '{"amount":"12.50","merchant":"Name or null","currency":"SGD","confidence":"high|ambiguous"}',
  "amount is the grand total paid. If unsure, confidence=ambiguous and best-guess amount.",
  "Never invent a total when no number is present — use amount null and confidence ambiguous.",
].join("\n");

function parseJsonBlob(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const v = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function extractReceiptFields(
  input: { text: string; imageUrl?: string },
  config: XaiConfig,
  fetchImpl: FetchLike = fetch,
): Promise<ReceiptExtract | null> {
  const blob = input.text.trim();
  if (blob.length === 0 && !input.imageUrl) return null;
  const url = `${config.baseUrl}/chat/completions`;
  const userContent: Array<Record<string, unknown>> = [];
  if (blob.length > 0) userContent.push({ type: "text", text: blob.slice(0, 4000) });
  if (input.imageUrl) {
    userContent.push({
      type: "image_url",
      image_url: { url: input.imageUrl },
    });
  }
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: 120,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent.length === 1 ? blob.slice(0, 4000) : userContent },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) return null;
  const obj = parseJsonBlob(content);
  if (obj === null) {
    return {
      amountCents: null,
      merchant: null,
      currency: "SGD",
      confidence: "ambiguous",
      raw: content,
    };
  }
  const amountRaw = obj.amount;
  let amountCents: number | null = null;
  if (typeof amountRaw === "number" && Number.isFinite(amountRaw)) {
    amountCents = Math.round(amountRaw * 100);
  } else if (typeof amountRaw === "string") {
    amountCents = parseMoneyToCents(amountRaw);
  }
  const merchant =
    typeof obj.merchant === "string" && obj.merchant.trim().length > 0
      ? obj.merchant.trim().slice(0, 80)
      : null;
  const currency =
    typeof obj.currency === "string" && obj.currency.trim().length === 3
      ? obj.currency.trim().toUpperCase()
      : "SGD";
  const confRaw = typeof obj.confidence === "string" ? obj.confidence.toLowerCase() : "ambiguous";
  let confidence: "high" | "ambiguous" = confRaw === "high" ? "high" : "ambiguous";
  if (amountCents === null) confidence = "ambiguous";
  return { amountCents, merchant, currency, confidence, raw: content };
}

/** Heuristic fallback when LLM off: scrape first money token + short merchant guess. */
export function extractReceiptHeuristic(text: string): ReceiptExtract {
  const money = text.match(/\$?\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?/);
  const amountCents = money ? parseMoneyToCents(money[0]) : null;
  const withoutMoney = text.replace(money?.[0] ?? "", " ").replace(/\s+/g, " ").trim();
  const merchant = withoutMoney.length > 0 ? withoutMoney.split(/\s+/).slice(0, 4).join(" ") : null;
  return {
    amountCents,
    merchant,
    currency: "SGD",
    confidence: amountCents === null ? "ambiguous" : "ambiguous",
    raw: text,
  };
}

export async function extractReceipt(
  input: { text: string; imageUrl?: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<ReceiptExtract> {
  if (isLlmRoutingEnabled(env)) {
    const config = loadXaiConfig(env);
    if (config !== null) {
      const llm = await extractReceiptFields(input, config, fetchImpl);
      if (llm !== null) return llm;
    }
  }
  return extractReceiptHeuristic(input.text);
}
