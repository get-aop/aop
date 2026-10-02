# PR View

GitHub's pull request page inside AOP, shown where the coordinator chat is: the header, the Conversation, Commits, Checks and Files changed tabs, the sidebar, the merge box, and the host owner's actions. The host reads GitHub through its own `gh` (`apps/local-server/src/pull-request-view/`); the dashboard is `apps/dashboard/src/projects/pull-request-view/`.

## Feature IDs

- `prv-open`: the ways in: a thread's PR chip in the panel, the thread's PR bar, the PR chip on a thread card in the chat, a markdown link to one of the project's pull requests, and the address `/projects/:id[/threads/:threadId]/pulls/:repoId/:number`. Out again: the `Coordinator` breadcrumb, `×`, Escape, browser back.
- `prv-read`: every tab and state (ready, blocked for each reason, draft with checks running, merged, closed, empty, large and huge diffs, read-only), polling, Refresh, and the errors (not signed in, rate limited, not found).
- `prv-act`: comment, approve, request changes, merge (and a merge GitHub refuses), rename, close, reopen, draft, ready, Ask the coordinator.
- `prv-device`: a paired device sees the page read-only.

## Fixture `gh`

Never act on real pull requests. `scripts/fake-gh-pr-view.ts` answers the calls the PR View makes from the fixtures in `scripts/pr-view-fixtures.ts` (#1 ready, #2 blocked for five reasons, #3 draft with checks running, #4 merged, #5 closed, #6 320 files and a 20,000-line file, #7 empty, #8 read-only, #9 behind; `acme/fixtures`). Writes change its state, so they show on the page. Switch files in `$FAKE_GH_DIR` (default `<home>/fake-gh`): `signed-out`, `rate-limited`, `refuse-merge` (one time). `fake reset` restores the fixtures.

```bash
mkdir -p .work/fakebin
printf '#!/bin/sh\nexec bun %s/.claude/skills/verify/scripts/fake-gh-pr-view.ts "$@"\n' "$PWD" > .work/fakebin/gh
chmod +x .work/fakebin/gh
git init -q -b main .work/repos/fixtures && git -C .work/repos/fixtures commit -q --allow-empty -m init
git -C .work/repos/fixtures remote add origin https://github.com/acme/fixtures.git
PATH=$PWD/.work/fakebin:$PATH bun $S/verify-stack.ts start --name <run>
bun $S/seed.ts --name <run> --fake-runtime
# register .work/repos/fixtures with POST <api>/api/repos, create a project with it
```

To give a thread a pull request for the entry points, start a thread with the fake runtime and set its PR columns in the DB: `update chat_sessions set pr_number=1, pr_url='https://github.com/acme/fixtures/pull/1', pr_state='open' where id='<threadId>'`. Restart the server (`restart-server`, keep the fake `gh` on `PATH`) after host code changes; the server is not watched.

The host caches a read for 10 seconds (checks 5), and the `gh` login for a minute (10 seconds while signed out): after changing fixture state, wait or press Refresh; after `signed-out`, `restart-server`.

## Test handles

| `data-testid` | What it is |
| --- | --- |
| `pull-request-pane`, `pull-request-pane-coordinator`, `pull-request-pane-close` | The frame in the chat's place, its breadcrumb and `×` |
| `pull-request-view` (`data-state`, `data-tab`), `pull-request-view-loading`, `pull-request-view-error` (`data-code`), `pull-request-view-retry`, `pull-request-view-stale` | The page and its states |
| `pr-header` (`data-compact` on the Files tab), `pr-title`, `pr-title-edit`, `pr-title-input`, `pr-state-badge` (`data-state`), `pr-merge-sentence`, `pr-copy-branch`, `pr-checks-summary`, `pr-refresh`, `pr-ask-coordinator`, `pr-ask-question`, `pr-ask-send`, `pr-open-github`, `pr-state-menu`, `pr-toggle-draft`, `pr-toggle-open` | The header |
| `pr-tab-{conversation,commits,checks,files}` | The tabs (Radix: they switch on pointer down) |
| `pr-description`, `pr-timeline`, `pr-comment`, `pr-review-verdict`, `pr-timeline-event`, `pr-timeline-commits`, `pr-timeline-omitted`, `pr-review-threads`, `pr-review-thread` (`data-resolved`) | Conversation |
| `pr-merge-box` (`data-status` = `ready`, `blocked`, `done`), `pr-merge-checks`, `pr-merge-conflicts`, `pr-merge-blockers`, `pr-merge-blocker` (`data-kind`), `pr-merge-warnings`, `pr-merge`, `pr-merge-method`, `pr-merge-method-{squash,merge,rebase}`, `pr-merge-read-only`, `pr-reopen`, `pr-ready`, `pr-convert-draft` | The merge box |
| `pr-comment-box`, `pr-comment-input`, `pr-comment-submit`, `pr-approve`, `pr-request-changes` | The host owner's comment and review box |
| `pr-sidebar`, `pull-request-view-thread`, `pr-reviewer` (`data-state`), `pr-label` | The sidebar |
| `pr-check` (`data-status`, `data-required`), `pr-check-details` | Checks |
| `pr-files-tab`, `pr-files-count`, `pr-files-filter`, `pr-diff-unified`, `pr-diff-split`, `pr-file-tree`, `pr-file-tree-toggle`, `pr-file-tree-file`, `pr-file` (`data-path`, `data-collapsed`), `pr-file-large`, `pr-file-load`, `pr-file-no-patch`, `pr-files-empty`, `pr-files-error` | Files changed; the diff itself is `diffs-container` with a shadow root |
| `thread-pr-chip`, `chat-thread-card-pr`, `pr-bar-chip` (`data-opens` = `view` or `github`) | The chips that open it |

## Gotchas

- Real GitHub pull requests are for read-only checks only (open `get-aop/aop`'s through a clone of it registered as a repository). Write actions go to the fixtures.
- A `gh` stand-in must write its output synchronously: `process.exit` right after an asynchronous write to a pipe cuts it at 64 KB, and the host then gets half a page of files.
- CUA key presses (Escape) sometimes land outside the page right after a navigation; click inside the page first.
- `get_browser_state` without a narrow `query` on the Files tab returns hundreds of nodes; always pass one.
