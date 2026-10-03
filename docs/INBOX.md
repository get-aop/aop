# Inbox

The Inbox shows the Slack activity that needs you, and nothing else: direct mentions, DMs and group DMs, replies in threads you are part of, mentions of groups you are in, and @here and @channel. You can add keywords. From any item you can reply as yourself, dispatch an AOP thread, link it to a thread, a pull request or an issue, mark it done, snooze it, mute its channel, or open it in Slack.

Open it with the **Inbox** button in the top bar, on every screen, or at `/inbox`. The button appears once Slack is connected and shows how many items are unread. How it works inside: [architecture/inbox.md](./architecture/inbox.md).

## Connect Slack

AOP reads your Slack through a small app that only you install, in your own workspace. Nothing goes through a server of AOP's: the host connects to Slack directly, and your tokens stay on the host.

Open **AOP settings › Connections › Slack**.

1. **Create the Slack app.** **Open Slack** opens Slack's "Create an app" page with AOP's manifest filled in. Pick your workspace and click **Create**. The manifest turns on Socket Mode, so Slack never asks for a Request URL. It also turns on sign-in without a secret (PKCE) and lists this host's sign-in address. **Copy manifest** copies it, if you would rather paste it into Slack yourself.
2. **Sign in with Slack.** On your new app's **Basic Information** page, copy two things:
   - The **Client ID**, under App Credentials. It is not a secret.
   - An **app-level token**. Under App-Level Tokens, click **Generate Token and Scopes**, add the scope `connections:write`, and copy the token that starts with `xapp-`. This is the one key you paste.

   Click **Allow in Slack**. Slack asks you to allow the app, which installs it, and sends you back to the host. The page says **Slack is connected**.
3. **Test the connection.** The test passes only when a real message travels from Slack to AOP.
   - **Send it for me** posts "AOP connection test" to your own DM in Slack, as you, after you confirm. It deletes the message as soon as it arrives.
   - **I'll send myself a message** waits up to a minute for a message you send yourself.

If your workspace requires admin approval for apps, Slack sends the request to an admin and the sign-in waits for them.

### Pasting the tokens instead

**Paste the two tokens instead** takes:

- the User OAuth Token, which starts with `xoxp-` (OAuth & Permissions, after you install the app);
- the app-level token, which starts with `xapp-`.

**Save and start** is offered once a test has passed with exactly those tokens. Use this for an app you set up by hand, or one whose PKCE you do not want to turn on: in Slack, turning PKCE on cannot be undone.

If you set the app up by hand, the order matters:

1. Settings › Socket Mode › on.
2. Event Subscriptions › Enable Events, then add `message.channels`, `message.groups`, `message.im` and `message.mpim` under "Subscribe to events on behalf of users", and Save.
3. Add the 13 User Token Scopes from the manifest.
4. Install the app, or Reinstall it if Slack asks.

If Event Subscriptions asks for a Request URL, Socket Mode is off.

### When something is wrong

The test names each problem and its fix:

- a scope is missing: add it and reinstall;
- the token in the user field is a bot token (`xoxb-`);
- the app-level token lacks `connections:write`.

**Connected, but Slack sends no events** means Socket Mode is off in the app's settings. Slack still accepts the connection, but it never delivers a message. Turn Socket Mode on, enable the four user message events, Save, and Reinstall if Slack asks. Then test again. AOP also watches for this while it runs. When it notices, the Inbox's header and the Slack settings turn amber with the same fix. Meanwhile the Inbox still fills from AOP's own reads, a few minutes late.

When Slack refuses the token, because the app was removed or the token revoked, the settings say so: sign in again.

## The Inbox page

The views across the top are **Needs me**, **Mentions**, **DMs**, **Threads**, **Snoozed** and **Done**. They are filters, not folders. When a channel is mapped to a project, a **Project** filter shows only those channels.

Each item shows:

- who sent it and where (the channel, the DM, or "· thread" for a thread);
- why it is in the Inbox: the strongest reason, from "@you" down to "Keyword";
- the message, with links you can click;
- the conversation around it, folded. Opening it reads the thread's first message and its last three replies from Slack; **N earlier replies** reads the rest.

A DM conversation is one item, and so is a thread. A new message brings an item back to unread, even when it was done or snoozed.

What you can do with an item:

| Action | What it does |
| --- | --- |
| **Reply** | Posts in the item's thread (or its DM) as you, only when you press Send or ⌘↵. **Also send to #channel** posts it in the channel too. AOP never drafts a reply. |
| **Dispatch thread** | Starts an AOP thread from the item. Pick the project (preselected when the channel is mapped) and the repository, or **Ask the coordinator**. Then edit the brief. The thread gets the brief and the parts you leave ticked: the thread context, a linked issue, the Slack link. It never gets a Slack tool and cannot read the Inbox. |
| **PR notes** | An option in Dispatch, off by default. When the thread opens or merges a pull request, AOP posts "Opened a PR for this: … (via AOP)" and later "Merged: … (via AOP)" in the Slack thread, as you. It asks first and shows the exact text. Turn it off later from the thread's chip on the item. |
| **Link…** | Links the item to an issue (from any of the project's Issues-tab sources: GitHub, Linear, Jira), a pull request or a thread. You can also paste an address or a key (`OPS-1184`, `#58`). Links are AOP's own notes: nothing is posted anywhere. A thread dispatched from an item is linked by itself, and its pull request is linked too once the thread opens one. |
| **Done** | Takes the item out of Needs me. |
| **Snooze** | 1 hour, this afternoon, tomorrow 09:00, next Monday, or a time you pick. The item comes back as unread then. |
| **⋯** | Open in Slack, Copy link, Only direct mentions in #channel, Mute #channel, Map #channel to a project. |

Keys: **J**/**K** move, **E** done, **R** reply, **D** dispatch, **O** open in Slack.

On a narrow screen the list and the item take turns.

## Rules

**Settings › Connections › Slack › Rules** decides what reaches the Inbox:

- **Triggers**, on by default: direct mentions, DMs and group DMs, replies in your threads, groups you're in, and @here and @channel.
- **Keywords**, off until you add one. A keyword matches as a whole word, ignoring case.
- **Channels**, listing only the ones you changed. Each can be set to **Everything that counts**, **Only direct mentions** or **Muted**, and mapped to a project. A muted channel stores nothing.

A rule applies to new messages; it does not rewrite the list.

## Notifications

The badge always counts unread items in Needs me. Desktop notifications are off by default, because Slack already notifies you. The choices are:

- **Only when I'm away from Slack**: DMs and direct mentions while Slack shows you away;
- **Everything in Needs me**: every new item.

The AOP desktop app shows them, and clicking one opens the item. A browser shows the badge only. Slack's Do Not Disturb silences them.

## Privacy

- **Tokens** stay on the host, in `$AOP_HOME/connections/slack/<team>.json` (readable by the host's user only). Any of your paired devices can save them; none can read them back.
- **Messages:** only those that matched a rule are kept, on the host, in `$AOP_HOME/inbox/inbox.db`, a file of their own outside AOP's main database. After the retention you pick (7, 30 or 90 days, or forever; 30 by default), their text is deleted. Items linked to something keep the link. **Disconnect** can delete every stored message too.
- **Agents** never read the Inbox: no tool, command or project file shows it to them. A thread sees a message only when you dispatch it.
- **Posting:** only your click sends a reply. The one automatic post is the PR notes, which you turn on per dispatch.

The host and its agents run as the same user on the host machine, so an agent with shell access could read those files, as it could read any other key on the host. AOP gives agents no path to them.
