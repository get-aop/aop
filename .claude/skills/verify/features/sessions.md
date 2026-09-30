# Sessions

Sessions is AOP's front door: a chat workbench per repository with a rail of sessions, a thread, and a composer with runtime, workflow, and access controls. This map covers what renders and the commands AOP handles itself. Anything that reaches the agent runtime is out of scope unless the user has agreed to that spend.

## Sub-features

- `sessions-home` renders the rail, the draft hero, and the composer for a repository session.
- `sessions-clear` settles the current session and opens a fresh sibling with `/clear`.

## How to get to it (user POV)

- Open `/` in the dashboard; the rail lists sessions grouped by repository.
- Choose **New session** in the rail (`data-testid=rail-new-session`).
- Type `/clear` in the composer of an open session.

## Driving it with verify-stack and drive

Preconditions:

- A started and seeded run.
- One session exists for the seeded repo. Create it through the API the dashboard uses: `curl -s -X POST <api>/api/chat-sessions -H 'content-type: application/json' -d '{"repoId":"<repoId>"}'`. The response holds `session.id`.

- **Open Sessions.** In Chrome, navigate to `<dashboard>/`, find `data-testid=app-rail` and `data-testid=chat-composer-input`, and take a screenshot. The screenshot shows the rail with a `New session` row under `repo`, the `aop` wordmark, the composer (placeholder `Ask anything, @tag files/folders, $use skills, or / for commands`), the suggestion chips, and a footer reading `Connected · v0.9.51+dev` (the version matches `package.json`).
- **Run `/clear`.** In Chrome, on `<dashboard>/`, click `data-testid=chat-composer-input`, type `/clear`, press Enter, and take a screenshot. AOP handles this command itself; no runtime starts.
- **Confirm the state change.** Run `curl -s <api>/api/chat-sessions`. The original session has `settledOverride: "settled"` and a `settledAt`, and a second session exists with `settledOverride: null`.
- **Proof.** Keep both screenshots and the two `/api/chat-sessions` responses (before and after), with the feature ID `sessions` and the entry point `composer /clear`.

## Gotchas

- Only `/clear` and `/alias` are handled by AOP. Any other text, including `/status` and `/workflow`, is forwarded to the session's runtime (default `claude-code`), which runs the real CLI with the user's auth. Observed: `/status` returned `/status isn't available in this environment.` from Claude Code. The AOP-handled commands are defined in `apps/local-server/src/chat-session/commands.ts`.
- The thread can list `N changed files` for the session's repo (seen when stray files sat in `repoPath`). The seed leaves the fixture repo clean; changed files you did not create mean something wrote there.
- The composer's `/`, `#`, `%`, `~`, `$`, and `@` menus are typeahead only until a message is sent; opening them is safe, sending is not.
- A new session showed `Claude Code` as its runtime, not the test-mode fixture agent. In the code, `AOP_TEST_MODE` is read by the task orchestrator, not by chat.
