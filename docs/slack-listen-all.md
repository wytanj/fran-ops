# SLACK_LISTEN_ALL

When `SLACK_LISTEN_ALL=true` (also `1` / `yes` / `on`), inbound Slack `message` / `app_mention` / `reaction_added` synthesize a channel grant if the channel is absent from `CHANNEL_ALLOWLIST` + `SLACK_EXTRA_CHANNELS`. Slack membership (invite the bot) remains the listen SoT. Synthetic grants use name `listen:<channelId>` so bus `ensureChannel` can upsert `channel_allowlist`.

## Write lane stays strict

`/bird` (`handleFranCommand`) and other call sites that use `findGrant()` alone stay gated to the code/env allowlist. Tool/write paths do not inherit listen-all.

## Durable SoT (later)

DB `channel_lanes` is the intended durable listen/write separation. This flag is the interim ops knob until that lands.

## Env

```
# Optional. Default off. Droplet may set true so any channel the bot joins is ingested.
# SLACK_LISTEN_ALL=true
```
