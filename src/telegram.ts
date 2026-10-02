/**
 * Telegram webhook scaffold for bill-split + franbird parity.
 * Works when TELEGRAM_BOT_TOKEN is set; no live BotFather in this PR.
 * Same SoT (bill_* + staff_identities) as Slack.
 */

import { findGrant, parseExtraTelegramChatGrants, type ChannelGrant } from "./allowlist.ts";
export { parseExtraTelegramChatGrants } from "./allowlist.ts";
import {
  formatTallyLines,
  labelStaff,
  loadChannelBalances,
  proposeExpense,
  recordSettlement,
} from "./bill_bus.ts";
import { formatCents } from "./bill_domain.ts";
import { buildEqualShareRows, looksLikeBillCommand, parseBillExpense, parseBillTally } from "./bill_parse.ts";
import { findStaffBySurface } from "./bus.ts";
import type { Db } from "./db.ts";
import {
  parseChannelId,
  parseStaffId,
  parseTelegramUserId,
  type ChannelId,
  type StaffId,
} from "./domain.ts";

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    caption?: string;
    chat: { id: number; type: string };
    from?: { id: number; username?: string };
    photo?: Array<{ file_id: string; file_unique_id: string }>;
  };
};

export type TelegramSender = {
  sendMessage(chatId: string, text: string): Promise<void>;
};

export function loadTelegramConfig(env: NodeJS.ProcessEnv = process.env): {
  botToken: string;
  webhookSecret: string | null;
} | null {
  const botToken = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (botToken.length === 0) return null;
  const webhookSecret = (env.TELEGRAM_WEBHOOK_SECRET ?? "").trim() || null;
  return { botToken, webhookSecret };
}


export function verifyTelegramSecret(
  headerValue: string | undefined,
  expected: string | null,
): boolean {
  if (expected === null || expected.length === 0) return true;
  return headerValue === expected;
}

function requireStaffId(raw: string): StaffId {
  const id = parseStaffId(raw);
  if (id === null) throw new Error("staff_id not uuid");
  return id;
}

/** Strip /command@botname → command args */
function stripTgCommand(text: string): { command: string | null; args: string } {
  const m = text.trim().match(/^\/([a-zA-Z0-9_]+)(?:@[A-Za-z0-9_]+)?\s*([\s\S]*)$/);
  if (m === null) return { command: null, args: text.trim() };
  return { command: m[1]!.toLowerCase(), args: (m[2] ?? "").trim() };
}

/**
 * Map TG freeform/commands onto bill-split SoT.
 * Mentions on TG are plain @username — staff resolve is via telegram_user_id of sender only
 * for scaffold; participant lists accepted as numeric ids in text when present.
 */
export async function handleTelegramUpdate(
  db: Db,
  grants: readonly ChannelGrant[],
  update: TelegramUpdate,
  sender: TelegramSender,
): Promise<{ handled: boolean }> {
  const msg = update.message;
  if (msg === undefined || msg.from === undefined) return { handled: false };
  const chatId = String(msg.chat.id);
  const channelId = parseChannelId(chatId);
  if (channelId === null) return { handled: false };
  if (findGrant(grants, "telegram", channelId) === null) {
    // Silent drop — mirror Slack allowlist law
    return { handled: false };
  }

  const tgUser = parseTelegramUserId(String(msg.from.id));
  if (tgUser === null) return { handled: false };
  const actor = await findStaffBySurface(db, "telegram", tgUser);
  if (actor === null) {
    await sender.sendMessage(chatId, "Your Telegram user is not linked in staff_identities.");
    return { handled: true };
  }
  const actorStaffId = requireStaffId(actor.staffId);

  const text = (msg.text ?? msg.caption ?? "").trim();
  const { command, args } = stripTgCommand(text);
  const body = command !== null ? (args.length > 0 ? `${command} ${args}` : command) : text;

  // Photo receipt scaffold: store file_id URI, ask for split text (LLM extract when XAI set — caller can extend)
  if (msg.photo !== undefined && msg.photo.length > 0 && !looksLikeBillCommand(body) && command === null) {
    const best = msg.photo[msg.photo.length - 1]!;
    const uri = `telegram://${best.file_id}`;
    await sender.sendMessage(
      chatId,
      `Receipt noted (${uri}). Reply: split <amount> [merchant] (participants = you for now; link more staff via staff_identities).`,
    );
    return { handled: true };
  }

  if (command === "start" || command === "help" || body.toLowerCase() === "help") {
    await sender.sendMessage(
      chatId,
      [
        "Franbird TG bill-split:",
        "• /split <amount> [merchant]",
        "• /tally",
        "• /settle <telegram_user_id> <amount>  (or /paid)",
        "• /remind",
        "Writes need confirm on Slack-style cards when ambiguous; TG scaffold posts text confirm prompt.",
      ].join("\n"),
    );
    return { handled: true };
  }

  if (command === "tally" || parseBillTally(body)) {
    const { balances } = await loadChannelBalances(db, { surface: "telegram", channelId });
    const { lines, suggestions } = await formatTallyLines(db, balances);
    const sug =
      suggestions.length > 0 ? `\nSuggested:\n${suggestions.map((s) => `• ${s}`).join("\n")}` : "";
    await sender.sendMessage(chatId, `Tally\n${lines.join("\n")}${sug}`);
    return { handled: true };
  }

  if (command === "settle" || command === "paid" || /^settle\b|^paid\b/i.test(body)) {
    // TG settle: settle <tgUserId> <amount>
    const m = body.replace(/^(?:settle|paid)\b[:,]?\s*/i, "").trim().match(
      /^(\d{3,})\s+(\$?\d+(?:\.\d{1,2})?)/,
    );
    if (m === null) {
      await sender.sendMessage(chatId, "Usage: /settle <telegram_user_id> <amount>");
      return { handled: true };
    }
    const otherTg = parseTelegramUserId(m[1]!);
    if (otherTg === null) {
      await sender.sendMessage(chatId, "Bad telegram user id.");
      return { handled: true };
    }
    const other = await findStaffBySurface(db, "telegram", otherTg);
    if (other === null) {
      await sender.sendMessage(chatId, "That Telegram user is not linked in staff_identities.");
      return { handled: true };
    }
    const { parseMoneyToCents } = await import("./bill_domain.ts");
    const cents = parseMoneyToCents(m[2]!);
    if (cents === null) {
      await sender.sendMessage(chatId, "Bad amount.");
      return { handled: true };
    }
    const recorded = await recordSettlement(db, {
      grants,
      fromStaffId: actorStaffId,
      toStaffId: requireStaffId(other.staffId),
      amountCents: cents,
      surface: "telegram",
      channelId,
      threadRef: String(msg.message_id),
      createdByStaffId: actorStaffId,
      idempotencyKey: `telegram:settle:${update.update_id}`,
    });
    if (!recorded.ok) {
      await sender.sendMessage(chatId, `Settle failed: ${recorded.reason}`);
      return { handled: true };
    }
    await sender.sendMessage(
      chatId,
      `Recorded: you paid ${await labelStaff(db, requireStaffId(other.staffId))} ${formatCents(cents)}.`,
    );
    return { handled: true };
  }

  if (command === "split" || command === "expense" || command === "bill" || looksLikeBillCommand(body)) {
    // Reuse slack-oriented parser for amount/merchant; TG has no <@U…> mentions in scaffold
    const slackish = body.replace(/^(?:split|expense|bill)\b/i, "split");
    const parsed = parseBillExpense(slackish);
    if (!parsed.ok) {
      await sender.sendMessage(chatId, "Usage: /split <amount> [merchant]");
      return { handled: true };
    }
    // Scaffold: payer-only equal share (ambiguous) → text confirm instruction
    const shares = buildEqualShareRows(parsed.value.amountCents, actorStaffId, []);
    const proposed = await proposeExpense(db, {
      grants,
      payerStaffId: actorStaffId,
      createdByStaffId: actorStaffId,
      amountCents: parsed.value.amountCents,
      currency: parsed.value.currency,
      merchant: parsed.value.merchant,
      note: parsed.value.note,
      shares: shares.map((s) => ({ staffId: s.staffId as StaffId, shareCents: s.shareCents })),
      surface: "telegram",
      channelId,
      threadRef: String(msg.message_id),
      parseConfidence: "ambiguous",
      idempotencyKey: `telegram:expense:${update.update_id}`,
      autoConfirmIfHigh: false,
    });
    if (!proposed.ok) {
      await sender.sendMessage(chatId, `Expense failed: ${proposed.reason}`);
      return { handled: true };
    }
    const exp = proposed.value.expense;
    await sender.sendMessage(
      chatId,
      [
        `Draft expense ${formatCents(exp.amountCents, exp.currency)}${exp.merchant ? ` @ ${exp.merchant}` : ""} (pending confirm).`,
        `id=${exp.id}`,
        "Reply /confirm_expense <id> or /reject_expense <id>. Ambiguous TG splits stay pending.",
      ].join("\n"),
    );
    return { handled: true };
  }

  if (command === "confirm_expense" || command === "reject_expense") {
    const { parseExpenseId } = await import("./bill_domain.ts");
    const { confirmExpense, voidExpense } = await import("./bill_bus.ts");
    const id = parseExpenseId(args.trim());
    if (id === null) {
      await sender.sendMessage(chatId, "Usage: /confirm_expense <uuid>");
      return { handled: true };
    }
    if (command === "confirm_expense") {
      const r = await confirmExpense(db, { expenseId: id, staffId: actorStaffId });
      await sender.sendMessage(chatId, r.ok ? "Expense confirmed." : `Failed: ${r.reason}`);
    } else {
      const r = await voidExpense(db, { expenseId: id, staffId: actorStaffId });
      await sender.sendMessage(chatId, r.ok ? "Expense rejected." : `Failed: ${r.reason}`);
    }
    return { handled: true };
  }

  return { handled: false };
}

export function createTelegramPoster(botToken: string, fetchImpl: typeof fetch = fetch): TelegramSender {
  return {
    async sendMessage(chatId, text) {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) {
        throw new Error(`telegram sendMessage failed: ${res.status}`);
      }
    },
  };
}

/**
 * Mount POST /telegram/webhook on an Express-like app.
 * No-op when TELEGRAM_BOT_TOKEN unset.
 */
export function mountTelegramWebhook(
  app: {
    post: (path: string, handler: (req: any, res: any) => unknown) => unknown;
  },
  opts: {
    db: Db;
    grants: readonly ChannelGrant[];
    env?: NodeJS.ProcessEnv;
  },
): boolean {
  const env = opts.env ?? process.env;
  const config = loadTelegramConfig(env);
  if (config === null) return false;
  const tgGrants = [
    ...opts.grants.filter((g) => g.surface === "telegram"),
    ...parseExtraTelegramChatGrants(env.TELEGRAM_EXTRA_CHATS),
  ];
  const sender = createTelegramPoster(config.botToken);
  app.post("/telegram/webhook", async (req: any, res: any) => {
    const secret = req.headers?.["x-telegram-bot-api-secret-token"] as string | undefined;
    if (!verifyTelegramSecret(secret, config.webhookSecret)) {
      res.status(401).send("unauthorized");
      return;
    }
    try {
      const update = req.body as TelegramUpdate;
      await handleTelegramUpdate(opts.db, tgGrants, update, sender);
      res.status(200).json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "error" });
    }
  });
  return true;
}
