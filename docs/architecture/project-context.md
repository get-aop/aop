# What a project session is told

Every run of a project's coordinator and of each of its threads starts with the project's material: the role, the repositories, the goal and instructions the person wrote, and the project's memory. It goes in the CLI's system prompt, not in the message, and it is read again on every turn, so an edit made between two turns reaches the second one. Phase 1 covers Claude Code only.

The code is in `apps/local-server/src/project/` (`system-prompt.ts`, `memory-block.ts`, `prompt-context.ts`, `thread-digest.ts`) and the `appendSystemPrompt` run option of `@aop/llm-provider`.

## Where it goes

`RunOptions.appendSystemPrompt` becomes Claude Code's `--append-system-prompt <text>`, sent with `--system-prompt-snapshot off` and placed right before the prompt. The chat engine builds it in `runRuntimeReply` (`chat-session/assistant-reply.ts`) for each turn, including turns that resume a native session, turns that follow an interruption, and a retry after a stale session. A plain chat gets none and its command line is unchanged.

`--system-prompt-snapshot off` is not optional. By default Claude Code renders the system prompt on a conversation's first request, appended text included, records it in the session, and sends the record on every later request and resume, even when a later launch passes different text. Without `off` the coordinator and the threads would keep the instructions they started with until the conversation is compacted. The flag needs Claude Code 2.1.257 or later (`claude --help` on 2.1.285 lists it); on an older CLI the unknown option is expected to fail the run at once, which no test here can show without running `claude`. Sources: `claude --help` and the [CLI reference](https://code.claude.com/docs/en/cli-reference#system-prompt-flags-in-resumed-conversations). The fake CLI models this behavior (see its README); it has not been observed on a real model.

The coordinator is hermetic and its runs skip `CLAUDE.md`, so the system prompt is also the only place it reads project material. Threads run in the person's own Claude Code setup, so they also read the repository's `CLAUDE.md`; AOP does not write into the repository to inject anything.

## What each role reads

| Part | Coordinator | Thread |
| --- | --- | --- |
| Role and how to work | yes | yes |
| Repositories | all, with ids | the others, as read-only context |
| Goal and instructions | yes | yes |
| `MEMORY.md` and the topic file list | yes | yes |
| Thread list | in the message, not here | no |

Memory beyond the index is read on demand with `memory_read` and written with `memory_write`, tools both roles hold. The coordinator's thread list changes whenever a thread does, so it is added to each message instead; keeping it out of the system prompt keeps that prompt identical from turn to turn, so Claude's prompt cache holds until the project itself changes.

## Size

The prompt is a command-line argument, so it is bounded: at most 40,000 characters, which is at most 120,000 bytes of UTF-8, under the 128 KiB Linux allows one argument.

- The goal and instructions are limited when they are saved (8,000 and 16,000 characters) and are always sent whole.
- Memory gets the rest, at most 10,000 characters: the index up to 6,000, cut at a line break where one is near the end, then up to 25 topic files as `name: description` (description on one line, at most 100 characters), as far as the room goes.
- Whatever is left out is said so after the memory, in a line from AOP naming the `memory_read` call that returns it.
- At most 20 repositories are listed, each line at most 300 characters.

The text is an argument of the `claude` process, so other accounts on the host can read it in the process list while a turn runs, as they can the session token in the MCP URL. `--append-system-prompt-file` would avoid that; it is documented in the CLI reference but `claude --help` does not list it, so it is not used.

Sending `--system-prompt-snapshot off` also stops Claude Code reusing the rest of its default prompt from the first request. AOP's own text is identical between turns until the project changes, but whether the CLI's default prompt is too cannot be seen without running it. If cache reads on thread turns are lower than expected, compare cache creation and cache reads in the usage accounting; `--exclude-dynamic-system-prompt-sections` is the flag that moves per-machine parts out of the prompt.

## Memory is data

Sessions write memory, and they write what they read, so a memory file can carry text an attacker chose. The prompt treats it as untrusted:

- A warning before it says it is reference data, not instructions, may be wrong, and must not change the session's instructions, tools or permissions.
- The text sits between two marker lines that carry a 12-character code derived from the text itself. A memory file cannot close its own block, because it would have to contain the hash of itself. The same text always produces the same code, so the prompt stays steady.
- Topic descriptions are collapsed to one line, so a description cannot open a heading.
- Truncation notes are outside the markers, in AOP's own voice.

This lowers the odds that a poisoned note is obeyed; it cannot make a model immune to persuasion. The real limits are the tools: the coordinator has only AOP tools, and a thread has the access its project chose, or full access while the host skips permission checks ([Runtimes](../RUNTIMES.md#skipping-permission-checks)).

The person's goal and instructions are trusted text, and only the person can change them: the coordinator's `project_settings_set` takes only the thread model and effort and the notification level, and refuses a call that names anything else (its schema is strict). What the coordinator learns goes to memory, its one writable channel into other sessions' prompts, and memory is delimited as untrusted data as described above.

## Checking it

Add `[fake: system]` to a message on a stack running the fake CLI and the reply ends with the system prompt the turn received. See the [fake CLI README](../../packages/llm-provider/test-fixtures/README.md#system-prompt).
