import type { KnownBlock } from "@slack/types";
import type { BriefingMode, TaskTemplateKey } from "./domain.ts";

export type SlackCard = {
  text: string;
  blocks: KnownBlock[];
};

function shortTaskId(taskId: string): string {
  const id = taskId.trim().toLowerCase();
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function draftForApproveCard(input: {
  title: string;
  templateKey: TaskTemplateKey;
  taskId: string;
  staffLabel: string;
}): SlackCard {
  return {
    text: input.title,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: input.title },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Template* ${input.templateKey}\n*Staff* ${input.staffLabel}` },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Task \`${shortTaskId(input.taskId)}\` · Approve or Send back`,
          },
        ],
      },
      {
        type: "actions",
        block_id: `task.${input.taskId}`,
        elements: [
          {
            type: "button",
            action_id: "card.approve",
            style: "primary",
            text: { type: "plain_text", text: "Approve" },
            value: input.taskId,
          },
          {
            type: "button",
            action_id: "card.send_back",
            text: { type: "plain_text", text: "Send back" },
            value: input.taskId,
          },
        ],
      },
    ],
  };
}

export function franbirdTellCard(input: {
  taskId: string;
  body: string;
  openerLabel: string;
  assigneeLabel: string;
  briefing: BriefingMode;
}): SlackCard {
  const briefingLabel = input.briefing === "required" ? "required" : "optional";
  return {
    text: `Franbird tell (briefing ${briefingLabel})`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Franbird tell" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*To* ${input.assigneeLabel}\n*From* ${input.openerLabel}\n*Briefing* ${briefingLabel}\n\n${input.body}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Task \`${shortTaskId(input.taskId)}\` · Approve or Send back`,
          },
        ],
      },
      {
        type: "actions",
        block_id: `task.${input.taskId}`,
        elements: [
          {
            type: "button",
            action_id: "card.approve",
            style: "primary",
            text: { type: "plain_text", text: "Approve" },
            value: input.taskId,
          },
          {
            type: "button",
            action_id: "card.send_back",
            text: { type: "plain_text", text: "Send back" },
            value: input.taskId,
          },
        ],
      },
    ],
  };
}

export function ackCard(input: {
  taskId: string;
  text: string;
}): SlackCard {
  return {
    text: input.text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: input.text },
      },
    ],
  };
}

export function resolvedTellCard(input: {
  body: string;
  decision: "approve" | "send_back";
}): SlackCard {
  const label = input.decision === "approve" ? "Approved" : "Sent back";
  return {
    text: `Franbird tell — ${label}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `Franbird tell — ${label}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: input.body },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Decision: *${label}* · actions closed`,
          },
        ],
      },
    ],
  };
}

/** Prefer section mrkdwn from the original card so replace_original keeps To/From/body. */
export function extractCardBodyFromMessage(message: unknown): string {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return "Franbird tell";
  }
  const record = message as Record<string, unknown>;
  const blocks = record.blocks;
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
      const b = block as Record<string, unknown>;
      if (b.type !== "section") continue;
      const text = b.text;
      if (typeof text !== "object" || text === null || Array.isArray(text)) continue;
      const t = text as Record<string, unknown>;
      if (typeof t.text === "string" && t.text.trim().length > 0) return t.text;
    }
  }
  if (typeof record.text === "string" && record.text.trim().length > 0) return record.text;
  return "Franbird tell";
}
