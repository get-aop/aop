# Run scheduling

How the host decides which thread turns run, and what it does when Claude Code refuses a turn because a usage limit is reached. The code is `apps/local-server/src/scheduling/` (policy, stored state) and `apps/local-server/src/chat-session/run-dispatch.ts` and `rate-limit-resume.ts` (the engine's side).

## The cap on running thread turns

Every agent turn is one Claude Code process. A coordinator can start many threads, so the host runs at most `max_concurrent_runs` thread turns at once. The default is 4 and the setting takes a whole number from 1 to 32.

```bash
curl -X PUT http://127.0.0.1:25150/api/settings/max_concurrent_runs \
  -H 'content-type: application/json' -d '{"value":"2"}'
```

The cap can also be set in the dashboard, under Settings > General > Runs, which refuses a value outside that range before it is sent. A value outside that range is refused by the host with a `400` and the old value stays. Raising the cap starts waiting turns at once. Lowering it never stops a turn that is running; the count falls as turns end.

- **Only thread turns count and only they wait.** A coordinator turn or a plain chat is something a person is waiting on, and it is bounded by one per session. It never uses a slot, never queues, and so is never starved: a thread report wakes the coordinator even while every slot is taken.
- **A turn that has to wait puts its thread in the `queued` status**, with the status line "Waiting for a free run slot". Starting it makes the thread `working`. Both changes are `thread.upserted` entries on the project's event stream.
- **Turns start first come first served.** The order is when a turn's message was stored, across all threads. A steer sent to a running thread waits behind the turns that queued before it.
- **The queue is stored, not held in memory.** A queued turn is a user message that has no run yet, which is also how a steer waits for its own session. Nothing needs recovering after a restart beyond looking again: at boot the host starts as many waiting turns as the cap allows, in the same order. Runs still going when the server stopped count against the cap until they end.
- **Stopping a queued thread ends its wait**: the message is cancelled, the thread is `idle`, and it never runs.
- **A turn that cannot start** (its workspace is gone) fails with the reason instead of holding up the turns behind it.

One dispatcher decides which turn runs next. It runs one pass at a time, from stored state, and it is called whenever something changes: a message is stored, a run ends, the cap changes, the server starts. A pass that finds nothing to do does nothing, so calling it too often is harmless. A server that is shutting down stops dispatching, so ending its running turns does not start the waiting ones.

## Rate and usage limits

When a run ends because Claude Code hit a limit, the session waits and resumes instead of failing.

- **A thread** goes to the `rate-limited` status, carrying `resumesAt`, the time it resumes. The run is stored as `failed` with the failure kind `rate_limit`, and the thread's reply says when it resumes. The coordinator is not woken for it: the turn is not over.
- **A coordinator** has no status, so its wait is only the stored `resumes_at`. While it is set, thread reports wait in its inbox instead of starting runs the limit would refuse.
- **Any other chat** fails the run with what the CLI said. Nothing resumes it.

A wait ends in one of three ways, and all of them do the same thing:

1. **The reset.** A timer resumes the session at `resumesAt`. The time is stored on the session, so a restart re-arms the timer, and a wait that came due while the server was down resumes at once.
2. **The person resumes it**, with `POST /api/threads/:id/resume`. This answers `409` for a thread that is not `rate-limited`.
3. **The person sends the thread a message.** That is a retry, so the wait ends and the message runs.

Resuming is idempotent: it acts only on a session that is waiting. A timer that fires twice, a resume that races a message, and a re-armed timer after a restart all end the same. The resume takes up a message the session already had queued, or else queues one the person never sees ("Your usage limit has reset. Continue with the task where you left off."), so the session goes on in the Claude Code session it already has. Stop ends a thread's wait for good.

If the reset time is not known, the session retries after 15 minutes. If the CLI's reset time is already past, it retries after 30 seconds.

### What a limit looks like, and what is not verified

The real Claude Code CLI was never run for this. The shapes come from its [error reference](https://code.claude.com/docs/en/errors), the [Agent SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript) and third-party reports, and the fake CLI plays them (see `packages/llm-provider/test-fixtures/README.md`, "Usage limits"). A run counts as limited when the log ends in an error result and any of these shows:

- a `rate_limit_event` whose `rate_limit_info.status` is `rejected` (paid overage does not count), with `resetsAt` in epoch seconds;
- an assistant event flagged `"error": "rate_limit"`;
- a result with `api_error_status: 429`;
- result text such as `You've hit your session limit · resets 3:45pm` or `You've hit your weekly limit · resets Mon 12:00am`.

A reset given as a wall-clock time has no zone in Claude Code's text, so it is read in the host's own time zone, which is the zone the CLI runs in.

Not verified against the real CLI: the exact field values, the order of the events, the exit code of a limited run (the host does not rely on it), whether `resetsAt` always names the window that blocks the run, and the wording of the text in other CLI versions. A limit the host does not recognise fails the run as before.

The host does not yet hold every run when one is limited. A limit on the account applies to every session, so waiting threads that start meanwhile each meet it and go on hold in turn. Each costs one quick failed start.
