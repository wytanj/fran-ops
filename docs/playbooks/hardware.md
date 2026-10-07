# Hardware playbook

`#it-helpdesk` (`C0C6J930A6L`) is the only place a hardware issue opens. The issue row is the ledger. A person raises it with a photo, and JT approves it. The bus does not send email.

## Raise

Post a photo in `#it-helpdesk`. A caption is optional. The bus writes an issue with playbook `hardware` and status `waiting_approve`, then queues an approve card in that photo's thread. The card text includes the issue id.

Use this caption when you know the claim fields.

`device: S10B cracked site: Bugis+ mirror tablet drop: 900mm`

`device`, `site`, `drop`, `serial`, and `kind` are optional labels. A bare `900mm` or `dropped ~900mm` still fills the drop height. Other words stay on the caption. `serial` names the device. The seed caption below includes it.

## Approve

JT is the only approver. Set `ISSUE_APPROVER_SLACK_USER_ID` to his Slack user id, and keep that id on his `staff_identities` row. Approve moves the issue to `in_progress`. Send back moves it to `blocked` and appends a note on `evidence`.

## Samsung Care+ claim

1. Confirm device, site, drop height, and photo refs on the issue payload.
2. Approve appends a Care+ email draft to `evidence`. `delivery` is `outbox_ready`.
3. When the issue is linked to an asset, approve also appends `claim_filed` on that asset.
4. A person sends that draft later. This playbook does not send mail.

`hardwareCarePlusDraft` in `src/issue_domain.ts` fills the subject and body from the payload.

## Device timeline

The bot owns the device timeline. People raise and approve issues. This scaffold has no screen for editing asset history.

`migrations/006_assets.sql` creates `assets` and `asset_events`. Both are insert-only. A trigger rejects updates and deletes. `oow` is an event on the same asset. It does not remove the asset or earlier events.

`serial` on the caption is the device identity. Raise with a serial inserts the asset and appends `crack`. The actor is `bot`. `kind` defaults to `device`. The issue payload stores `assetId`, `serial`, and `kind`, and evidence gains an `asset` ref. `repair`, `swap`, and `retire` use the same append path when a later step learns them.

## Seed issue

Do not file the S10B case from a migration or from a live Slack post in a class A session. After `migrations/005_issues.sql` and `migrations/006_assets.sql` are applied and the approver env is set, JT posts the photo in `#it-helpdesk` with:

`device: S10B cracked site: Bugis+ mirror tablet drop: 900mm serial: R5GL855Q7PD kind: mirror`

That raise inserts asset serial `R5GL855Q7PD`, kind `mirror`, site `Bugis+ mirror tablet`, and appends `crack`. The dry-run fixture in `test/issue_bus.test.ts` uses that caption and does not post to Slack. Applying either migration on the droplet is class D.

## Learned steps

Append one bullet when a vendor step changes. Leave older bullets in place. Name the date and the step.

- 2026-10-07. Stub only. No vendor step learned yet.

## Status

Raise writes `waiting_approve`. Approve writes `in_progress`. Send back writes `blocked`. `open` and `done` are legal ledger values for a later step. This scaffold does not write them from Slack.
