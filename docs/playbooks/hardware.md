# Hardware playbook

`#it-helpdesk` (`C0C6J930A6L`) is the only place a hardware issue opens. The issue row is the ledger. A person raises it with a photo, and JT approves it. The bus does not send email.

## Raise

Post a photo in `#it-helpdesk`. A caption is optional. The bus writes an issue with playbook `hardware` and status `waiting_approve`, then queues an approve card in that photo's thread. The card text includes the issue id.

Use this caption when you know the claim fields.

`device: S10B cracked site: Bugis+ mirror tablet drop: 900mm`

`device`, `site`, and `drop` are optional labels. A bare `900mm` or `dropped ~900mm` still fills the drop height. Other words stay on the caption.

## Approve

JT is the only approver. Set `ISSUE_APPROVER_SLACK_USER_ID` to his Slack user id, and keep that id on his `staff_identities` row. Approve moves the issue to `in_progress`. Send back moves it to `blocked` and appends a note on `evidence`.

## Samsung Care+ claim

1. Confirm device, site, drop height, and photo refs on the issue payload.
2. Approve appends a Care+ email draft to `evidence`. `delivery` is `outbox_ready`.
3. A person sends that draft later. This playbook does not send mail.

`hardwareCarePlusDraft` in `src/issue_domain.ts` fills the subject and body from the payload.

## Seed issue

Do not file the S10B case from a migration or from a live Slack post in a class A session. After `migrations/005_issues.sql` is applied and the approver env is set, JT posts the photo in `#it-helpdesk` with the caption above. The dry-run fixture in `test/issue_bus.test.ts` uses that caption and does not post to Slack.

## Learned steps

Append one bullet when a vendor step changes. Leave older bullets in place. Name the date and the step.

- 2026-10-07. Stub only. No vendor step learned yet.

## Status

Raise writes `waiting_approve`. Approve writes `in_progress`. Send back writes `blocked`. `open` and `done` are legal ledger values for a later step. This scaffold does not write them from Slack.
