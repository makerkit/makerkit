---
'@makerkit/mailpit': minor
---

Initial release: `emails_list`, `emails_read`, `emails_set_read_status` and `mailbox_status` for reading a local Mailpit inbox from a coding agent, extracted from the Makerkit kits' MCP servers. The Mailpit URL, the "how to start Mailpit" hint, the Docker Compose check and a tool name prefix are settings.

Fixes compared to the kit tools, checked against Mailpit 1.27 and 1.31:

- `emails_set_read_status` uses Mailpit's `PUT /api/v1/messages` endpoint (the kit's endpoints return 405) and fails for an unknown email id.
- `from` is no longer empty: Mailpit sends the sender as one object, not a list.
- `emails_read` returns the email's headers and date, and reports the email as read, which Mailpit does when it is fetched.
