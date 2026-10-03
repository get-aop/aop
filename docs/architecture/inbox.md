# The Inbox

The Inbox shows the activity from the person's message sources that needs them: mentions, DMs, replies in their threads, groups they are in, @here and @channel, and keywords they chose. Slack is the first source. The full design, including the screens still to come, is the "Slack Inbox in AOP" design in the project Library.

What is built so far is the host's core: the store, the rules, triage and links. No source feeds it yet, so the Inbox stays empty until the Slack connection lands.

## Where it lives

| Part | Code |
| --- | --- |
| Wire types (`InboxItem`, `InboxRules`, views, states, links) | `packages/common/src/inbox.ts` |
| Host domain | `apps/local-server/src/inbox/` |
| The database and its migrations | `inbox/database.ts`, `inbox/inbox-v1.ts` |
| Whether a message needs the person | `inbox/matcher.ts` |
| Ingest, triage, links, retention | `inbox/service.ts`, `inbox/repository.ts`, `inbox/retention.ts` |

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

## Host API

All routes are under `/api/inbox` and open to any authenticated client: the person triages from paired devices too. This is decision D3 of the design.

| Route | What |
| --- | --- |
| `GET /summary` | `{ unread }` for the top bar's badge |
| `GET /items?view=&cursor=&limit=` | A page of a view, newest first |
| `GET /items/:id` | One item with its links |
| `PUT /items/:id/state` `{state}` or `{state: "snoozed", until}` | Mark read, unread or done, or snooze it |
| `POST /items/:id/links` `{kind, ref, projectId?, title?, url?}` | Link it; linking twice is a no-op |
| `DELETE /items/:id/links/:linkId` | Unlink it |

## Agents

Agents never read the Inbox: no MCP tool, CLI command or project file exposes it. A thread sees a message only when the person dispatches it to the thread.
