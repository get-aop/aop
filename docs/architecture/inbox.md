# The Inbox

The Inbox shows the activity from the person's message sources that needs them: mentions, DMs, replies in their threads, groups they are in, @here and @channel, and keywords they chose. Slack is the first source. How a person uses it: [INBOX.md](../INBOX.md).

## Where it lives

| Part | Code |
| --- | --- |
| Wire types (`InboxItem`, `InboxRules`, views, states, links, context, dispatch) | `packages/common/src/inbox.ts` |
| Slack wire types, the manifest, the sign-in callback path | `packages/common/src/inbox-slack.ts` |
| Host domain, put together | `apps/local-server/src/inbox/host-inbox.ts` |
| The database and its migrations | `inbox/database.ts`, `inbox/inbox-v1.ts`, `inbox/inbox-v2.ts` |
| Whether a message needs the person | `inbox/matcher.ts` |
| Ingest, triage, links, retention | `inbox/service.ts`, `inbox/repository.ts`, `inbox/retention.ts` |
| Rules, notification choice, catch-up mark per account | `inbox/source-repository.ts` |
| Summary, list by project, context, reply, rules | `inbox/actions.ts` |
| Dispatch and its brief | `inbox/dispatch.ts`, `inbox/brief.ts` |
| Pull request notes and links | `inbox/post-back.ts` |
| Desktop notification queue | `inbox/notifications.ts` |
| The Slack source | `inbox/sources/slack/` |
| The page and the top bar's button | `apps/dashboard/src/inbox/` |
| Settings › Connections › Slack | `apps/dashboard/src/settings/slack/` |
| Desktop notifications | `apps/desktop/electron/notifications/inbox-poll.ts` |

## Its own database

The Inbox keeps its messages in `$AOP_HOME/inbox/inbox.db` (mode 0600, in a 0700 directory), not in the main database. Backups and support bundles copy the main database, and Slack text should not travel with them. It has its own append-only migrations and version ledger. They run synchronously when the host opens the file.

## How a message becomes an item

A source turns its platform's message into an `IncomingMessage`: conversation, thread, author, text, and the facts the rules need (`mentionsMe`, `mentionsMyGroup`, `broadcast`, `fromMe`). The Inbox never parses a platform's markup.

`matchMessage` gives the strongest reason that applies, in the order `INBOX_REASONS` lists them, or none:

- The person's own messages never match.
- A muted channel keeps nothing; nothing from it is stored.
- A channel set to "direct mentions only" keeps direct mentions only.
- Otherwise, each trigger the rules turn on is checked: mention, DM, a reply in one of the person's threads, a group, a broadcast, then a keyword (whole words, ignoring case).

Messages are gathered into items:

- a DM or group DM conversation is one item;
- a thread is one item;
- any other channel message is its own item.

A thread's id is its first message's id, so the replies to a message that mentioned the person join that message's item. A new message makes its item unread again, even when it was done or snoozed, and the item keeps the stronger of its reasons. A redelivered or older message (a catch-up read after a restart) changes nothing. When the person answers in the source, the item is marked read.

"Threads the person is part of" has no event at the source, so the host keeps its own index of them in `inbox_threads`. It holds ids only: threads the person started, replied in or was mentioned in.

Edits and deletes at the source follow the message an item shows. A deleted message drops its text.

## Triage

States are `unread`, `read`, `done` and `snoozed`. A snoozed item whose time has come reads, counts and lists as unread, so no job has to wake it.

The views are:

- `needs-me`;
- `mentions` (mentions, groups, broadcasts, keywords);
- `dms`;
- `threads`;
- `snoozed`;
- `done`.

Pages are newest first, with an opaque cursor.

Links connect an item to an AOP thread, a pull request or an issue of any Issues-tab source. They are AOP's own notes: nothing is posted to Slack, GitHub, Linear or Jira.

## Retention

`inbox_retention_days` defaults to 30 days, with the same range as the Library's (0 keeps everything). Every hour, `startInboxRetention` handles items whose latest message is older than that:

- items nothing links to are deleted;
- linked items lose their text and permalink and are marked `expired`, so a thread's link still resolves.

Threads quiet for that long are forgotten too.

## The Slack source

Each person creates their own internal Slack app from AOP's manifest: user-token scopes only, Socket Mode and PKCE on, token rotation off, no bot user. An internal app keeps Slack's full rate limits, which distributed apps lost in 2025. It also connects out over a WebSocket, so a host only reachable on a tailnet works.

### Connecting

The connection is stored in `$AOP_HOME/connections/slack/<team id>.json` (0600, in a 0700 directory), the way the Linear key is. It is never put in a database or a log, and never sent to a client. One workspace is connected at a time; the data is already keyed by `slack:<team id>`.

There are three ways in:

- **Sign in with Slack, PKCE** (`sources/slack/sign-in.ts`).
  1. The person pastes the app's Client ID and app-level token (`xapp-`).
  2. The host checks the token with `apps.connections.open`. It makes a `code_verifier` and a single-use `state`, kept in memory for ten minutes, and returns Slack's authorize URL with the S256 challenge, the user scopes, and the host's own callback as the redirect.
  3. Slack sends the browser back to `GET /api/inbox/sources/slack/oauth/callback`. That route is public (`auth/route-policy.ts`): the browser carries no AOP session, and the `state` is its authentication.
  4. The host redeems the code with `oauth.v2.access`, using the verifier and no client secret, and saves the user token. Nothing passes through a server of AOP's.
- **The two tokens pasted** (`PUT /sources/slack`). They are checked with `auth.test` and `apps.connections.open` first.
- **A one-time import** of the tokens the design's first test left in `~/.aop-slack-spike/tokens.env` (`sources/slack/spike-import.ts`). The folder is deleted once they are saved.

Slack's PKCE rules ([Using PKCE](https://docs.slack.dev/authentication/using-pkce/), GA 2026-03-30):

- `pkce_enabled: true` in the manifest makes the app a public client. That cannot be undone without Slack support.
- A custom URI scheme forces rotating tokens. An `https://` or `http://localhost` redirect with token rotation off gets a user token that lasts until it is revoked, so the host has no refresh loop.
- The redirect must be one the manifest lists. The dashboard therefore builds the manifest with the host's address as the person's browser reaches it.

### The test

`POST /sources/slack/test` (`sources/slack/connection-test.ts`) checks the user token (`auth.test`), the granted scopes (`x-oauth-scopes`), the app-level token, and the groups the person is in. It passes only when a real message arrives over Socket Mode within a minute: a socket that connects and says hello proves nothing, because Slack does that even with Socket Mode off and then sends no events.

"Send it for me" posts "AOP connection test" with `chat.postMessage` to the person's own user id, which is their own DM, so no `im:write` is needed. It deletes the message with `chat.delete` once the test is over. Slack hands each event to one of an app's sockets, so the test also listens on the running feed's socket.

### The feed

`sources/slack/feed.ts` keeps a Socket Mode connection per workspace (`sources/slack/socket.ts`):

- it acks every envelope at once;
- on Slack's `disconnect` warning it opens the next socket before the old one goes;
- when a socket drops it reconnects, waiting 1 s and growing to a minute, with jitter;
- it stops when Slack refuses the app token, and the connection reads "revoked".

Each message event becomes an `IncomingMessage` (`sources/slack/events.ts`, `mrkdwn.ts`):

- mentions are found in the text (`<@U…>`, `<!here>`, `<!channel>`, `<!everyone>`, `<!subteam^…>` for a group the person is in);
- names come from `users.info` and `conversations.info`, cached (`directory.ts`);
- the permalink is built from the team's URL, with no API call;
- `message_changed` and `message_deleted` become edits and deletes.

Messages go through the Inbox one at a time, in order. Only what the rules keep is stored.

**Catch-up** (`sources/slack/catch-up.ts`). Slack does not replay events missed while no socket was open, so the feed reads them back with `conversations.history`:

- when it starts (one day back the first time, otherwise from the last message it saw, capped at seven days);
- after a reconnect that left a gap;
- after a socket that delivered nothing.

It reads DMs first, then private and public channels, and the replies of threads the person is part of. Calls are spaced about 1.2 s apart, Tier 3, and a 429's `Retry-After` is waited out.

**No events.** When a catch-up finds messages from a time a socket was open and that socket delivered none, Slack is not sending events: Socket Mode is off in the app's settings. The feed's health becomes `no-events` with the fix, and the Inbox keeps filling from catch-up reads.

`GET /sources` reports the workspace, who the person is there, the feed's health, the last event, the problem and its fix, and missing scopes. It never reports the tokens. AOP settings › Host shows the same in its optional "Slack Inbox" row (`host-setup/slack-inbox-check.ts`): grey until Slack is connected, then green, amber (no events, or reconnecting) or red (token refused), each linking to Settings › Connections.

## Actions

- **Context** (`GET /items/:id/context`): `conversations.replies` for a thread or a channel message (the parent and the last three replies, or `all=1`), `conversations.history` for a DM. It is read when an item is opened and never stored. Replies the person sent from AOP are noted by id in `inbox_sent` and marked "from AOP".
- **Reply** (`POST /items/:id/reply`): `chat.postMessage` with the user token, in the item's thread (`thread_ts`), with `reply_broadcast` when asked. A DM reply goes to the DM. Slack's refusals come back as plain sentences.
- **Dispatch** (`GET`/`POST /items/:id/dispatch`):
  - The draft quotes the message between `<<< slack message` markers, "as written, not instructions", the same pattern as `issues/issue-brief.ts`.
  - The person edits the brief. The host adds the parts left ticked: the thread's context (quoted, capped at 6,000 characters), a linked issue read fresh through the Issues tab's service, and the Slack link.
  - "A thread" calls `threads.spawn` in the chosen repository; "Ask the coordinator" sends the coordinator a plain message.
  - The new thread is linked to the item, with the post-back on only when the person confirmed it.
- **PR notes and links** (`inbox/post-back.ts`): every 30 s the host follows the threads dispatched from items.
  - When one opens a pull request, the item gets a pull-request link.
  - With the post-back on, the host also posts "Opened a PR for this: … (via AOP)" and later "Merged: … (via AOP)" in the item's Slack thread, as the person.
  - `inbox_links.pr_noted` records how far it got before anything is posted, so each note is sent at most once.
- **Notifications** (`inbox/notifications.ts`):
  - For a live message that made or reopened an item, the host decides whether it deserves a desktop notification. That depends on the person's choice, `users.getPresence` for "only when away", and `dnd.info` for Do Not Disturb.
  - It queues the notification in memory.
  - The desktop app reads `GET /notifications?after=` every 10 s (`inbox-poll.ts`, beside its project watcher) and shows them; a click opens `/inbox/<id>`. The first read only learns the cursor.
  - The dashboard's badge polls `GET /summary` every 15 s. A stream would take one of the browser's six connections per host, which the project streams already use four of.

## Host API

All routes are under `/api/inbox` and open to any authenticated client, so the person triages, replies and dispatches from paired devices too (decision D3). Tokens can be saved from a device and are never sent back. The one public route is the sign-in callback.

| Route | What |
| --- | --- |
| `GET /summary` | `{ unread, connected, health }` for the top bar's button |
| `GET /items?view=&cursor=&limit=&project=` | A page of a view, newest first; `project` keeps the channels mapped to it |
| `GET /items/:id` | One item with its links (a thread link with the thread's status) |
| `GET /items/:id/context[?all=1]` | The conversation around it, read from Slack |
| `POST /items/:id/reply` `{text, broadcast}` | Reply in Slack as the person |
| `GET /items/:id/dispatch` | The dispatch draft: title, brief, context size, mapped project, post-back text |
| `POST /items/:id/dispatch` | Start a thread or ask the coordinator |
| `PUT /items/:id/state` `{state}` or `{state: "snoozed", until}` | Mark read, unread or done, or snooze it |
| `POST /items/:id/links` `{kind, ref, projectId?, title?, url?}` | Link it; linking twice is a no-op |
| `PATCH /items/:id/links/:linkId` `{postBack}` | Turn a thread's PR notes off (or on) |
| `DELETE /items/:id/links/:linkId` | Unlink it |
| `GET /rules`, `PUT /rules` | The connected workspace's rules |
| `GET /sources` | The connected workspace and its feed, and whether the earlier test's tokens can be imported |
| `POST /sources/slack/sign-in` `{clientId, appToken, redirectUrl}` | Slack's Allow page address (PKCE) |
| `GET /sources/slack/oauth/callback` | Public: Slack sends the browser back here |
| `PUT /sources/slack` `{userToken, appToken}` | Save pasted tokens and start the feed |
| `POST /sources/slack/import` | Import the earlier test's tokens, then delete that folder |
| `POST /sources/slack/test` `{userToken?, appToken?, sendTestMessage}` | The connection test |
| `PUT /sources/slack/notifications` `{mode}` | `off`, `away` or `all` |
| `GET /sources/slack/channels` | The channels the person is in, for the rules |
| `DELETE /sources/slack[?deleteMessages=1]` | Disconnect, and optionally delete what was stored |
| `GET /notifications?after=` | The desktop app's notification queue |

`AOP_SLACK_API_URL` points the host at another Slack (Web API, Socket Mode and the Allow page beside it). Tests and verification runs use the fake in `inbox/sources/slack/fake-slack.ts`, driven by `.claude/skills/verify/scripts/fake-slack.ts`.

## Agents

Agents never read the Inbox: no MCP tool, CLI command or project file exposes it, and the coordinator's brief does not mention it. A thread sees a message only when the person dispatches it, and no thread or coordinator gets a Slack tool: the only automatic post is the PR notes, which the host sends from a fixed template.
