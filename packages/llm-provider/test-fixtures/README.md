# Fake agent CLI

`fake-cli.ts` is a standalone executable that stands in for `claude` so the real adapters, the real spawn and detach path, and the real log tail can be exercised without a model, credentials or spend. It speaks Claude Code's `--output-format stream-json` dialect. It is test tooling: nothing under `src/` imports it and it is not part of the package build.

The fake replaces only the executable, so everything from `ClaudeCodeProvider.run()` down is production code: the real spawn and detach path, pids, kill, resume, streaming and crash handling.

## Point an adapter at it

`RunOptions.runtimeAlias` is the executable the adapter spawns. An absolute path is used as-is (`resolveRuntimeAlias` in `src/runtime-alias.ts`).

```ts
import { ClaudeCodeProvider } from "@aop/llm-provider";

await new ClaudeCodeProvider().run({
  prompt: "hello [fake: steps=2 delay=200]",
  runtimeAlias: "/abs/path/to/packages/llm-provider/test-fixtures/fake-cli.ts",
  logFilePath: "/tmp/run.jsonl",
  env: { FAKE_CLI_HOME: "/tmp/fake-cli-home" },
});
```

Through the app, the alias comes from a runtime configuration provider whose `command` is the same path and whose `driver` is `claude-code` (the only driver, and the default when omitted). Chat sessions copy it into `runtime_alias` and pass it to the adapter:

```bash
curl -X POST "$API/api/runtime-configuration/providers" -H 'content-type: application/json' \
  -d '{"name":"Fake CLI","command":"/abs/path/to/fake-cli.ts","driver":"claude-code"}'
curl -X POST "$API/api/runtime-configuration/providers/<provider id>/models" -H 'content-type: application/json' \
  -d '{"description":"Fake model","model":"fake-model","thinkingLevels":[]}'
```

A provider without a model is skipped when a session picks its default runtime.

Bind the session to that runtime configuration (the dashboard runtime picker, or `PATCH /api/chat-sessions/:id` with `runtimeConfigurationId`). A session with no runtime configuration has its alias re-resolved to plain `claude` on every send, so writing `runtime_alias` alone does not redirect it.

`bun .claude/skills/verify/scripts/seed.ts --name <run> --fake-runtime` registers the provider plus a model and puts it first, so new sessions in a verify stack default to it.

The file needs its executable bit (it is committed with mode 755) and `bun` on `PATH`. macOS and Linux only; the shebang does not run on native Windows.

## Scripting a turn

Put `[fake: key=value ...]` anywhere in the prompt. The last marker wins. Without a marker, `FAKE_CLI_SCRIPT` (same syntax, no brackets) applies to every turn of that process.

A value is bare (`steps=2`), `"double quoted"` or `'single quoted'`. A quoted value may contain spaces and `]`, so the marker ends at the first `]` outside quotes. A quote character with no partner is plain text (`say=don't` works).

| Key | Effect |
| --- | --- |
| `startup=<ms>` | Sleep before the first event (startup watchdog). |
| `delay=<ms>` | Sleep between events (streaming, inactivity watchdog, kill windows). |
| `steps=<n>` | `n` rounds of narration plus a Bash tool call and result before the reply. |
| `say="<text>"` | Final reply text. The default names the turn and session and echoes the prompt: `Fake reply for turn 2 of session <id> (resumed). You said: ...`. |
| `calls='[{"name":"thread_spawn","arguments":{...}}, ...]'` | MCP tool calls to the `aop` server, made in order after the `steps` rounds and before `ask`. `arguments` defaults to `{}`. A value that is not a JSON array of `{name, arguments?}` ends the turn with the failure `fake CLI: invalid calls directive` (exit 1) and makes no calls. See [MCP tool calls](#mcp-tool-calls). |
| `ask="<question>" options="a\|b" tool=<name>` | Ends the turn on a question tool call. The default tool is `aop_ask_user` with input `{question, options}`, a real MCP call when the run has an `aop` server (see below) and a scripted event otherwise. `tool=AskUserQuestion` emits Claude's native tool, always scripted. The turn ends successfully and waits; the answer is the next prompt. |
| `fail[="<message>"]` | Ends with Claude's `error_during_execution` result and exit 1. |
| `exit=<n>` | Exits with code `n` and no terminal event. Combined with `fail`, sets the failing exit code. |
| `crash[=<k>]` | Writes `k` whole events (default 2), then half of the next line, then SIGKILLs itself. |
| `ratelimit[=<seconds>]` | Ends the turn the way a usage limit ends one, with the reset `<seconds>` away (default 3600). See [Usage limits](#usage-limits). `fail` does not override it. |
| `usage=<in>,<out>,<cacheWrite>,<cacheRead>` | Tokens the turn reports as consumed. Omitted or non-numeric parts are 0. Without the key, or with a bare `usage`, the turn reports 10, 5, 200 and 4000. |
| `system` | Adds the appended system prompt the turn ran with (`--append-system-prompt`) to the end of its reply, between two marker lines, or `[appended system prompt: none]`. Lets a test or a screenshot read what the CLI was told. See [System prompt](#system-prompt). |

Events are one JSON line each, written synchronously to stdout, so a log file tails and resumes exactly like the real CLI's.

## Reported usage

Every turn reports the tokens from `usage=` the way Claude Code does:

- The `result` event carries `usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`), `modelUsage` keyed by the model the adapter passed with `--model` (`fake-claude` when none) and `total_cost_usd`. A failed turn reports them too.
- The cost is computed from the counts at Claude Opus list prices: $15, $75, $18.75 and $1.50 per million input, output, cache-write and cache-read tokens. For example, `usage=1000,200,3000,50000` costs $0.16125.
- Assistant events carry the same `message.usage` under one message id per turn, so a turn that dies before its `result` (`crash`, `exit`, a Stop) still has usage in its log.

## Usage limits

`[fake: ratelimit=<seconds>]` makes the turn refuse the way Claude Code refuses when a plan window is used up. After the `system` init event, the turn writes:

1. `{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":<epoch seconds>,"rateLimitType":"five_hour","overageStatus":"rejected","isUsingOverage":false}}`, with `resetsAt` `<seconds>` from now.
2. An `assistant` event flagged `"error":"rate_limit"` whose text is `You've hit your session limit · resets 3:45pm`: the reset as a local wall-clock time with no zone, which is how Claude Code prints it.
3. A `result` event with `subtype: "success"`, `is_error: true`, `api_error_status: 429` and that same text as `result`. It reports no tokens and no cost.

The exit code is 1; `exit=0` gives a limit hit that exits 0. A turn that resumes the session afterwards, with no marker, replies normally.

These shapes come from Claude Code's [error reference](https://code.claude.com/docs/en/errors) (the message text) and the [Agent SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript) (`SDKRateLimitEvent`, `SDKAssistantMessageError`, `api_error_status`), plus third-party reports for `resetsAt` being epoch seconds. Nothing here was checked against the real CLI, which these tests must never run: the field values, the order of the three events and the exit code are the documented or reported shape, not a recording.

## MCP tool calls

The adapter hands a run the AOP server as `--mcp-config '{"mcpServers":{"aop":{"type":"http","url":"..."}}}'` when `mcpServerUrl` is set, in hermetic and open isolation alike. The fake reads that URL and, for `calls` and for the default `ask`, talks to the server the way Claude Code would, so a coordinator or thread run exercises the real MCP endpoint, its session token and its tool set:

1. On the first call it POSTs `initialize` (protocol `2024-11-05`, client `fake-claude`) and `notifications/initialized`, then `tools/list` once per turn. Requests go to the URL exactly as given (it already carries `sessionId` and `accessToken`), with `content-type: application/json` and `accept: application/json, text/event-stream`. Responses must be JSON.
2. A tool that `tools/list` did not offer is not called. The model gets an error result, `No such tool available: mcp__aop__<name>`, which is how a thread's run shows that it cannot use a coordinator tool.
3. Otherwise it POSTs `tools/call {name, arguments}`. The client is strict: `result.content` must be an array of `{type: "text", text}` blocks. Anything else, such as a plain object, becomes the error result `invalid MCP tool result`. The tool text is the blocks joined with newlines.
4. The log shows an assistant `tool_use` named `mcp__aop__<name>` followed by a user `tool_result` carrying that text. `is_error` is true for `result.isError`, a JSON-RPC `error` (its message is the text), an HTTP error status or an unreachable server (`MCP server aop unreachable: <reason>`), and for a run with no `aop` server (`MCP server aop is not connected`). None of these fail the turn: it still ends with its normal reply, as a real model would carry on.

Each call happens when the fake reaches it, after the events before it are in the log and before its own result is written. The `tool_use` and `tool_result` lines are written together once the call returns.

`--mcp-config`, `--allowedTools`, `--disallowedTools`, `--add-dir` and `--tools` are variadic in the real parser, so the fake's argv parser lets each swallow a prompt that follows it. The adapter puts `--allowedTools`, `--tools` and `--add-dir` after the prompt for that reason. It still emits `--mcp-config` and `--disallowedTools` before the prompt, so they only leave the prompt alone while `--model`, `--effort` or the single-valued `--append-system-prompt` and `--system-prompt-snapshot` follow them; a run that sets none of those would lose its prompt in the real CLI, and the fake reports it as `no prompt given`.

```bash
# A coordinator turn that starts a thread, asks the user something, and waits:
[fake: calls='[{"name":"thread_spawn","arguments":{"title":"Fix login","prompt":"Investigate"}}]']
[fake: ask="Which one?" options="a|b"]
```

## System prompt

`RunOptions.appendSystemPrompt` becomes `--append-system-prompt <text> --system-prompt-snapshot off` (see `appendClaudeSystemPromptFlags` in `src/providers/claude-code.ts`), placed right before the prompt. The fake reads both flags. Add `[fake: system]` to a prompt, or `FAKE_CLI_SCRIPT=system` to the process, and the reply ends with what the turn ran with:

```
Fake reply for turn 2 of session <id> (resumed). You said: ...

[appended system prompt: 1234 characters]
# AOP project brief
...
[end of appended system prompt]
```

`readEchoedSystemPrompt(reply)` from `@aop/llm-provider/test-fixtures` reads it back (`null` for "none", `undefined` when the reply echoed nothing).

The fake also imitates what Claude Code does with that text on resume, because it decides whether an edit to a project's instructions reaches a resumed thread. By default (`--system-prompt-snapshot on`) Claude Code records the system prompt of a conversation's first request, appended text included, and sends that record on every later request and resume, even when a later launch passes different text or none, until the conversation is compacted. With `--system-prompt-snapshot off` it renders the prompt afresh each request. The fake stores the first launch's text in the session file and, unless `off` is passed, echoes that record on every resume. So a caller that forgets `off` sees stale text in the echo, as it would with the real CLI.

Where this comes from: `claude --help` (2.1.285, no model call) and the [CLI reference](https://code.claude.com/docs/en/cli-reference#system-prompt-flags-in-resumed-conversations), which says the flag needs Claude Code 2.1.257 or later. It has not been observed on a real model: nothing in this repo runs `claude`. Compaction, which also re-renders the prompt, is not imitated.

## Sessions and resume

Each invocation records its session under `$FAKE_CLI_HOME/sessions/claude/<id>.json` (the turn count and the recorded system prompt). `FAKE_CLI_HOME` falls back to `$AOP_HOME/fake-cli`, then the OS temp dir. `--resume <id>` continues a known id (same `session_id`, turn counter +1) and fails with exit 1 and `No conversation found with session ID: <id>` for an unknown one. A turn is recorded before any output, so killed and crashed turns leave resumable sessions.

## Tests

- `src/providers/claude-code.fake-cli.test.ts` runs the real `ClaudeCodeProvider` against it: spawn, streaming, resume, SIGTERM then resume, crash then resume, exit codes, failure, questions, both watchdogs.
- `src/providers/claude-code.fake-cli-mcp.test.ts` runs the same adapter, in hermetic and open isolation, against a small HTTP MCP endpoint: the fake's `calls` and `ask` reach it with the run's session token, a tool it does not list is refused, and the call happens mid-turn.
- `src/providers/claude-code.system-prompt.test.ts` and the system prompt case of `claude-code.fake-cli.test.ts` cover the flags the adapter builds and an edit reaching a resumed turn.
- `apps/local-server/src/chat-session/fake-cli.test.ts` drives the chat engine through the runtime-configuration seam: streamed progress, resume, Stop then resume, crash then resume. Its provider factory refuses to spawn anything but the fake, so a misrouted alias fails the test instead of calling a model.
- `fake-cli/*.test.ts` unit-test the fake itself, including that its argv parser accepts what the real adapter builds. `fake-cli/test-utils.ts` plays a turn in-process with a stubbed MCP connection.
- `test-utils.ts` has the sandbox, log reader and `waitFor` helpers, and is importable as `@aop/llm-provider/test-fixtures`.

## Adding another CLI

Codex and Pi are not implemented. To add one, write a module that satisfies `Dialect` in `fake-cli/types.ts` (argv recognition and parsing, plus event shapes for start, each beat kind and each ending), add it to `DIALECTS` in `fake-cli/run.ts`, and write its adapter test next to the adapter. Directives, session storage, timing and crash handling are shared.
