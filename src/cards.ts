import type { KnownBlock } from "@slack/types";
import type { TaskTemplateKey } from "./domain.ts";

export type SlackCard = {
  text: string;
  blocks: KnownBlock[];
};

export function draftForApproveCard(input: {
  title: string;
  templateKey: TaskTemplateKey;
  taskId: string;
  staffId: string;
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
        text: { type: "mrkdwn", text: `${input.templateKey}\nStaff ${input.staffId}` },
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
