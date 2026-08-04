# Browser and Computer Control in AOP

Chat control is explicit and one-turn scoped. Add one of these commands with `$` in the composer,
or select it from the `+` menu:

| Command | Control runtime | Capability |
| --- | --- | --- |
| `$CC_BROWSER_USE` | Claude Code | Browser |
| `$CX_BROWSER_USE` | Codex CLI | Browser |
| `$CC_COMPUTER_USE` | Claude Code | Computer (unsupported in detached sessions) |
| `$CX_COMPUTER_USE` | Codex CLI | Computer |

Write the requested action beside the command, for example:

```text
$CX_BROWSER_USE Sign in to the staging site and verify the invoice total.
```

## Routing behavior

When the current chat already uses the command's runtime, AOP forwards the request to that active
Claude or Codex CLI session with the matching native capability enabled for that turn only.

When the current chat uses another runtime, such as OpenCode or Pi, AOP starts a short-lived
specialist CLI session. It receives up to the six latest messages, individually truncated and capped
at 6,000 characters in total, plus the control request. This is bounded context, not a generated
summary.
After the specialist finishes, AOP resumes the original runtime with the specialist result so the
original runtime remains the orchestrator and produces the user-facing reply.

The specialist session is internal: its runtime session ID is never persisted as the chat's active
session and it cannot alter the orchestrator's selected runtime, model, or history.

## Configuration

Settings → **Computer and Browser Control** has separate model and thinking selectors for Claude
and Codex. AOP uses these only when it must delegate control to an internal specialist session.
For a direct command in an already-matching Claude or Codex chat, the chat's existing runtime
configuration remains in effect.

## Runtime prerequisites

Claude browser commands use its native Chrome integration (`--chrome`) with an isolated Playwright
MCP fallback. Claude computer control is rejected because the detached Claude session cannot provide
it; use `$CX_COMPUTER_USE` instead. Codex browser commands enable native browser features and the
isolated Playwright fallback. Codex computer commands enable native computer use. Computer control
also requires the operating-system permissions required by Codex.

## Safety boundary

Typing a `$..._USE` command or selecting it from the `+` menu is the explicit confirmation for that
single control turn. Browser control may attach Claude to the user's logged-in Chrome profile, where
page content can contain untrusted instructions. Use it only on trusted pages, keep sensitive tabs
closed, and review consequential changes before submitting them. The Playwright fallback runs
headless and isolated, but cannot replace Chrome when an authenticated browser session is required.

Workflow step `browserControl` and `computerControl` fields remain independent provider-runner
settings. They do not create or persist chat control sessions.
