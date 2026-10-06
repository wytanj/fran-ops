import type { KnownBlock } from "@slack/types";
import type { BriefingMode, TaskTemplateKey } from "./domain.ts";
import type { HardwarePayload } from "./issue_domain.ts";

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


export function expenseConfirmCard(input: {
  expenseId: string;
  amountLabel: string;
  payerLabel: string;
  shareLines: string;
  merchant: string | null;
  confidence: "high" | "ambiguous";
  receiptNote?: string | null;
}): SlackCard {
  const conf = input.confidence === "ambiguous" ? "Ambiguous parse — confirm before commit" : "Confirm expense";
  const merchant = input.merchant ? `*Merchant* ${input.merchant}\n` : "";
  const receipt = input.receiptNote ? `*Receipt* ${input.receiptNote}\n` : "";
  return {
    text: `Expense ${input.amountLabel}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: conf },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${merchant}${receipt}*Amount* ${input.amountLabel}\n*Paid by* ${input.payerLabel}\n*Shares*\n${input.shareLines}`,
        },
      },
      {
        type: "actions",
        block_id: `bill.${input.expenseId}`,
        elements: [
          {
            type: "button",
            action_id: "bill.confirm",
            style: "primary",
            text: { type: "plain_text", text: "Confirm" },
            value: input.expenseId,
          },
          {
            type: "button",
            action_id: "bill.reject",
            text: { type: "plain_text", text: "Reject" },
            value: input.expenseId,
          },
        ],
      },
    ],
  };
}

export function tallyCard(input: {
  channelLabel: string;
  balanceLines: string;
  suggestionLines: string;
  expenseIdForActions?: string | null;
}): SlackCard {
  const suggestions =
    input.suggestionLines.length > 0
      ? `\n\n*Suggested settles*\n${input.suggestionLines}`
      : "";
  const actions =
    input.expenseIdForActions !== undefined && input.expenseIdForActions !== null
      ? ([
          {
            type: "actions" as const,
            block_id: `bill.tally.${input.expenseIdForActions}`,
            elements: [
              {
                type: "button" as const,
                action_id: "bill.mark_paid",
                style: "primary" as const,
                text: { type: "plain_text" as const, text: "Mark paid" },
                value: input.expenseIdForActions,
              },
              {
                type: "button" as const,
                action_id: "bill.remind",
                text: { type: "plain_text" as const, text: "Remind" },
                value: input.expenseIdForActions,
              },
            ],
          },
        ] as KnownBlock[])
      : [];
  return {
    text: `Tally — ${input.channelLabel}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `Tally — ${input.channelLabel}` },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Balances*\n${input.balanceLines}${suggestions}`,
        },
      },
      ...actions,
    ],
  };
}

export function settleAckCard(input: {
  fromLabel: string;
  toLabel: string;
  amountLabel: string;
}): SlackCard {
  return {
    text: `Settled ${input.amountLabel}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Recorded: ${input.fromLabel} paid ${input.toLabel} ${input.amountLabel}.`,
        },
      },
    ],
  };
}

export function issueApproveCard(input: {
  issueId: string;
  raiserLabel: string;
  payload: HardwarePayload;
}): SlackCard {
  const device = input.payload.device ?? "unknown";
  const site = input.payload.site ?? "unknown";
  const drop = input.payload.dropHeightMm === null ? "unknown" : `${input.payload.dropHeightMm} mm`;
  return {
    text: `Hardware issue ${input.issueId}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Hardware issue" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `*Issue* ${input.issueId}`,
            `*Raiser* ${input.raiserLabel}`,
            `*Device* ${device}`,
            `*Site* ${site}`,
            `*Drop* ${drop}`,
            `*Photos* ${input.payload.photoRefs.length}`,
          ].join("\n"),
        },
      },
      {
        type: "actions",
        block_id: `issue.${input.issueId}`,
        elements: [
          {
            type: "button",
            action_id: "issue.approve",
            style: "primary",
            text: { type: "plain_text", text: "Approve" },
            value: input.issueId,
          },
          {
            type: "button",
            action_id: "issue.send_back",
            text: { type: "plain_text", text: "Send back" },
            value: input.issueId,
          },
        ],
      },
    ],
  };
}

export function issueResolvedCard(input: {
  issueId: string;
  decision: "approve" | "send_back";
}): SlackCard {
  const label = input.decision === "approve" ? "approved" : "sent back";
  return {
    text: `Hardware issue ${input.issueId} ${label}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `Hardware issue ${label}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Issue* ${input.issueId}` },
      },
    ],
  };
}

export function resolvedBillCard(input: {
  decision: "confirm" | "reject";
  summary: string;
}): SlackCard {
  const label = input.decision === "confirm" ? "Confirmed" : "Rejected";
  return {
    text: `Expense — ${label}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `Expense — ${label}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: input.summary },
      },
    ],
  };
}
