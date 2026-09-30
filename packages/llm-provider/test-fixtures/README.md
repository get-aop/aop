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

| Key | Effect |
| --- | --- |
| `startup=<ms>` | Sleep before the first event (startup watchdog). |
| `delay=<ms>` | Sleep between events (streaming, inactivity watchdog, kill windows). |
| `steps=<n>` | `n` rounds of narration plus a Bash tool call and result before the reply. |
| `say="<text>"` | Final reply text. The default names the turn and session and echoes the prompt: `Fake reply for turn 2 of session <id> (resumed). You said: ...`. |
| `ask="<question>" options="a\|b" tool=<name>` | Ends the turn on a question tool call. The default tool is `mcp__aop__aop_ask_user` with input `{question, options}`. `tool=AskUserQuestion` emits Claude's native tool instead. The turn ends successfully and waits; the answer is the next prompt. |
| `fail[="<message>"]` | Ends with Claude's `error_during_execution` result and exit 1. |
| `exit=<n>` | Exits with code `n` and no terminal event. Combined with `fail`, sets the failing exit code. |
| `crash[=<k>]` | Writes `k` whole events (default 2), then half of the next line, then SIGKILLs itself. |
| `usage=<in>,<out>,<cacheWrite>,<cacheRead>` | Tokens the turn reports as consumed. Omitted or non-numeric parts are 0. Without the key, or with a bare `usage`, the turn reports 10, 5, 200 and 4000. |

Events are one JSON line each, written synchronously to stdout, so a log file tails and resumes exactly like the real CLI's.

## Reported usage

Every turn reports the tokens from `usage=` the way Claude Code does:

- The `result` event carries `usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`), `modelUsage` keyed by the model the adapter passed with `--model` (`fake-claude` when none) and `total_cost_usd`. A failed turn reports them too.
- The cost is computed from the counts at Claude Opus list prices: $15, $75, $18.75 and $1.50 per million input, output, cache-write and cache-read tokens. For example, `usage=1000,200,3000,50000` costs $0.16125.
- Assistant events carry the same `message.usage` under one message id per turn, so a turn that dies before its `result` (`crash`, `exit`, a Stop) still has usage in its log.

## Sessions and resume

Each invocation records its session under `$FAKE_CLI_HOME/sessions/claude/<id>.json`. `FAKE_CLI_HOME` falls back to `$AOP_HOME/fake-cli`, then the OS temp dir. `--resume <id>` continues a known id (same `session_id`, turn counter +1) and fails with exit 1 and `No conversation found with session ID: <id>` for an unknown one. A turn is recorded before any output, so killed and crashed turns leave resumable sessions.

## Tests

- `src/providers/claude-code.fake-cli.test.ts` runs the real `ClaudeCodeProvider` against it: spawn, streaming, resume, SIGTERM then resume, crash then resume, exit codes, failure, questions, both watchdogs.
- `apps/local-server/src/chat-session/fake-cli.test.ts` drives the chat engine through the runtime-configuration seam: streamed progress, resume, Stop then resume, crash then resume. Its provider factory refuses to spawn anything but the fake, so a misrouted alias fails the test instead of calling a model.
- `fake-cli/*.test.ts` unit-test the fake itself, including that its argv parser accepts what the real adapter builds.
- `test-utils.ts` has the sandbox, log reader and `waitFor` helpers, and is importable as `@aop/llm-provider/test-fixtures`.

## Adding another CLI

Codex and Pi are not implemented. To add one, write a module that satisfies `Dialect` in `fake-cli/types.ts` (argv recognition and parsing, plus event shapes for start, each beat kind and each ending), add it to `DIALECTS` in `fake-cli/run.ts`, and write its adapter test next to the adapter. Directives, session storage, timing and crash handling are shared.
