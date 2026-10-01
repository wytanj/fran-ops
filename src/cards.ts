import type { KnownBlock } from "@slack/types";
import type { BriefingMode, TaskTemplateKey } from "./domain.ts";

export type SlackCard = {
  text: string;
  blocks: KnownBlock[];
};

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
        text: { type: "mrkdwn", text: `${input.templateKey}\nStaff ${input.staffLabel}` },
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
    ],
  };
}