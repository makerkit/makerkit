# @makerkit/mailpit

Lets coding agents read the emails your app sends in local development. It talks to [Mailpit](https://mailpit.axllent.org)'s HTTP API, so an agent testing sign-up, team invites or password resets can find the email, read its text, HTML and headers, and follow the link in it.

Works with any Mailpit: the Docker image (`axllent/mailpit`, port 8025), Docker Compose, or the one the Supabase CLI starts (port 54324 by default).

## Tools

| Tool | Does |
|---|---|
| `emails_list` | Lists received emails, newest first (`start`, `limit` up to 200) |
| `emails_read` | One email by id: subject, addresses, text, HTML and headers. Mailpit marks it as read |
| `emails_set_read_status` | Marks one email read or unread |
| `mailbox_status` | Whether Mailpit is running and its API answers, and how to start it when it is not |

When Mailpit is not running, the email tools fail with `Mailpit is not running at <url>.` followed by your start hint.

## Use from code

```ts
import { createMailpitService } from '@makerkit/mailpit';
import { createMailpitDeps } from '@makerkit/mailpit/node';

const mailpit = createMailpitService(createMailpitDeps(process.cwd()));

const { messages } = await mailpit.list({ start: 0, limit: 20 });
const invite = messages.find((message) =>
  message.to.some((to) => to.includes('new@example.com')),
);

if (invite) {
  const email = await mailpit.read({ id: invite.id });
  console.log(email.text);
}
```

### Settings

```ts
createMailpitDeps(root, {
  settings: {
    // Mailpit's root URL. Default: MAILPIT_URL, then http://127.0.0.1:8025.
    // A function is called on every tool call.
    url: 'http://127.0.0.1:54324',
    // Appended to the "not running" error.
    startHint: 'Run "supabase start".',
    // Also report whether the Compose service is up. Off by default.
    docker: { composeFile: 'docker-compose.dev.yml', service: 'mailpit' },
  },
  requestTimeoutMs: 5000, // default
});
```

`createMailpitService` accepts any object with a `request(url, init)` function, so you can replace `fetch` in tests or other runtimes.

## Add the tools to an MCP server

Requires `@modelcontextprotocol/sdk`.

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMailpitService } from '@makerkit/mailpit';
import { registerMailpitTools } from '@makerkit/mailpit/mcp';
import { createMailpitDeps } from '@makerkit/mailpit/node';

const server = new McpServer({ name: 'mailpit', version: '1.0.0' });

registerMailpitTools(server, createMailpitService(createMailpitDeps(process.cwd())));
```

Options (third argument): `prefix` is prepended to every tool name, and `statusTool: false` leaves out `mailbox_status` when your server already has a tool with that name.

## License

MIT
