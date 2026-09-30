# Next slices

These slices do not block Slack ingest or the Slack outbox publisher.

- WhatsApp context packs. Store the WhatsApp context database as markdown files under `contextpacks/`.
- wacli media into Slack. Copy WhatsApp media onto an allowlisted Slack channel.
- Telegram bird client. fran-bird on Telegram reads and writes the same event types as Slack. It should publish rows where `outbox.destination` is `telegram`. `publishPending` leaves those rows `pending` until that client exists.
