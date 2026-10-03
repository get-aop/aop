# Inbox (Slack)

The Inbox button in every top bar, the `/inbox` page, and AOP settings › Connections › Slack, against the fake Slack (`scripts/fake-slack.ts`). Never post to a real workspace from a verification run; the one real check (below) posts only to the person's own DM and deletes it.

## Preconditions

1. Start the fake Slack before the stack: `bun $S/fake-slack.ts serve --port 25491 > .work/verify/<run>/logs/fake-slack.log 2>&1 &` (record its PID; stop only that PID).
2. Start the stack with the fake in the server's environment: `AOP_SLACK_API_URL=http://127.0.0.1:25491/api/ bun $S/verify-stack.ts start --name <run>`, then `bun $S/seed.ts --name <run> --fake-runtime`. Create a project on the seeded repo (Projects recipe) so Dispatch has somewhere to start a thread.
3. For the production dashboard, set `DASHBOARD_STATIC_PATH=<worktree>/apps/dashboard/dist` after `bun run --filter @aop/dashboard build`, and open the API URL instead of the dev dashboard.
4. A paired-device run: put the stack behind `scripts/serve-proxy.ts` and pair (recipe `shell-pairing` in `projects-shell.md`). Tokens are write-only from a device, and every Inbox action works from one (decision D3).

## Entry points

| ID | Entry | What to prove |
| --- | --- | --- |
| IN-1 | Settings › Connections › Slack, not connected | Steps shown; Open Slack opens `api.slack.com/apps?new_app=1&manifest_yaml=…` whose manifest has `pkce_enabled: true`, `socket_mode_enabled: true` and this host's callback; Copy manifest |
| IN-2 | Sign in with Slack | Client ID `1111111111.2222222222` + app token `xapp-fake-app` → Allow in Slack opens the fake's Allow page; Allow lands on the host's `…/oauth/callback` page "Slack is connected"; Settings shows Acme as @Marcelo, Live |
| IN-3 | Sign-in refusals | wrong app token → error under the fields; Cancel on the Allow page → "Slack is not connected" page; reusing the callback URL → "expired or was already used" |
| IN-4 | Paste the two tokens instead | `xoxp-fake-user` / `xapp-fake-app`: Save stays disabled until a test passes; Send it for me asks first, then all five checks pass and `fake-slack.ts state` shows the test message posted to D0SELF and deleted |
| IN-5 | Test with Socket Mode off | `fake-slack.ts events off`, Test → Events fails with the Socket Mode fix; `events on` again |
| IN-6 | Import the earlier test's tokens | With `~/.aop-slack-spike/tokens.env` present (use a scratch `HOME` for the server), the banner offers them; Use them connects and deletes that folder |
| IN-7 | Top bar | Hidden before connecting; after `fake-slack.ts scenario`, the Inbox button shows the unread count on the projects page and a project page |
| IN-8 | `/inbox` list and views | Needs me lists the DM, the mention (thread), @here, the group, and the reply in your thread; not "lunch?"; Mentions/DMs/Threads filter; the edited group-DM text shows the edit; the deleted DM reads "Deleted in Slack" |
| IN-9 | Item | Who, where, "Here because…", time, link clickable, Thread context shows parent + replies, "N earlier replies" loads all; Open in Slack opens the fake's archive page |
| IN-10 | Reply | Text + Also send to #infra → Send; `fake-slack.ts state` shows chat.postMessage with `thread_ts` and `reply_broadcast`; context shows it "from AOP"; nothing is sent before the click |
| IN-11 | Dispatch | Project, thread, edited brief, context ticked, Slack link; post-back asks with the exact text; Keep off leaves it off; Start thread → toast Open, the item shows the thread chip; the thread's first message (fake runtime) holds the brief with `<<< slack message` |
| IN-12 | Link | Link… → Issues (needs an issue source: fake `gh` / Linear / Jira from `issues.md`), Pull requests, Threads, and a pasted key; chip appears; × removes it |
| IN-13 | Done, snooze, keys | E marks done and moves on; Done view lists it; a new message reopens it; Snooze › 1 hour moves it to Snoozed; J/K move, R focuses reply, D opens Dispatch, O opens Slack |
| IN-14 | Channel rules from the item | ⋯ › Mute #random, Only direct mentions in #eng-announce, Map #infra to a project; Settings › Rules shows them; the Project filter appears and filters |
| IN-15 | Rules and preferences | Triggers off/on, keywords, + Add a channel; Notifications Off / Only when away / Everything; Storage retention |
| IN-16 | Feed health | `fake-slack.ts drop` → Reconnecting, then Live; `events off`, say something, wait 6 s, `refresh` → "Connected, but Slack sends no events" in the Inbox header and Settings |
| IN-17 | Disconnect | With Also delete the stored messages → setup steps again, Inbox button gone, `/inbox` says Connect Slack |
| IN-18 | 400 px | At 400 CSS px the list and the item take turns; ← Inbox goes back |
| IN-19 | Desktop notification | Notifications = Everything; desktop app on the stack; a new DM shows an OS notification (log line `notification {kind: inbox}`), click opens `/inbox/<id>` |

## Real Slack (once, with the person's own tokens)

Connect with the person's tokens, check one live event arrives (a message they send, or Send it for me, which posts only to their own DM and deletes it). Never post anywhere else.
