# One staff id, two clients

A part-time or full-time employee is one row in `staff_identities`. The primary key is the FranHRM staff uuid, copied by value. This database does not foreign-key to FranHRM, because each Fran system has its own database.

`slack_user_id` and `telegram_user_id` are columns on that same row. A partial unique index on each column means one Slack user, and one Telegram user, belong to one staff id. The same person is not a second person on the other client.

`employment` uses the FranHRM words `full_time` and `part_time`. Those are the employees who get fran-bird on both clients. `channel_prefs` is reserved and defaults to `{}`.

The other shape was a link table with one row per client. Two rows would make "one person" a join. The columns make it the primary key. A third client would need a new column or a later migration. This slice has Slack and Telegram.

The Telegram client is not in this slice. `outbox.destination` can still be `telegram`, and the event type is the same value Slack uses, such as `task.opened`. `publishPending` selects `destination = 'slack'` and leaves Telegram rows `pending`.
