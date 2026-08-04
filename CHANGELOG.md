# Changelog

## 0.9.31 - 2026-08-03

### Added

- Armed workflow runs in chat: the composer's workflow rail gains a fire toggle;
  when armed, the next message runs the selected workflow sequentially in the
  session (each step its own agent), locks the composer with live step progress,
  and posts the final step output as the answer.
- Restored full GitHub release workflow: tag pushes now build Linux binaries,
  sign and notarize macOS DMGs, package the Windows NSIS installer, publish the
  GitHub Release, and deploy assets + the `latest/version` pointer to
  Cloudflare R2 — no local release step needed.

### Removed

- Chat-side task machinery: `/task`, `/assign`, `/worker` slash commands, the
  `aop_create_task` MCP tools and their proposal/approval cards. The workflow
  fire toggle is the only task-like path left in chat.
- Built-in workflow catalog (`aop-default-gpt`, `aop-default-claude`,
  `landing-page`); the Settings gallery now shows only user workflows.

### Changed

- Settings → Runtimes lists only custom runtimes; the built-in runtime catalog
  (Claude Code, Codex CLI, Grok, OpenCode, Pi) is fixed inside AOP.
- Desktop app self-hosts its fonts (no Google Fonts request); README clarifies
  the only outbound request is the disable-able update check.
- CI no longer runs fork PRs on self-hosted runners; release artifacts never
  include `.env`.

## 0.9.0 - 2026-07-18

### Added

- Git-aware session bar with branch, worktree, diffstat, GitHub CLI, and pull-request state.
- One-click session worktree creation and a sectioned composer add menu.
- Native session diff panel with expandable unchanged regions, syntax highlighting, and per-line review comments.
- Per-session review queue that persists drafts and sends deterministic, agent-readable review blocks.
- Pull-request creation, draft/manual alternatives, native CI check details, and merge controls inside sessions.
- Persistent merged pull-request bar and accessible PR detail hover card.

### Changed

- Shared GitHub CLI adapters now serve both task and session workflows through injectable command seams.
- Session PR polling pauses in hidden tabs, uses a fast cadence for active checks, and a slower cadence for external merge detection.

### Fixed

- Diff caps retain every changed line and trim only unchanged context.
- Repositories without CI checks can merge when GitHub reports the PR mergeable.
- Session merges no longer delete the local or remote branch.
- Failed worktree creation no longer leaks an unhandled promise rejection.
