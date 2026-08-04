# GitHub-native session workflow

AOP 0.9.0 keeps the normal branch-to-merge loop inside a session while Git remains the source of truth.

## Start in a worktree

Use the branch button in the composer toolbar to create a session worktree. AOP suggests a session-specific branch name, validates it through Git, binds the session to the new worktree, and keeps the repository's main checkout untouched.

The session bar shows the active worktree, branch, changed-file totals, and pull-request state. Select the diffstat to open the diff panel.

## Review the working tree

The diff panel compares the merge base of the default branch with the session working tree. Files can be collapsed, long unchanged regions can be expanded and collapsed in place, and supported source files use the dashboard's existing syntax-highlighting themes.

Hover a diff row and select `+` to add a review note. Notes are stored per session and appear above the composer. They can be edited or removed before sending. Sending drains the queue into one deterministic review message; a typed message is optional when review notes are queued.

## Create a pull request

On a non-default branch with changes or commits ahead of the base, use **Create PR**. The adjacent menu also supports a draft PR or GitHub's manual compare page.

AOP uses the installed GitHub CLI. If `gh` is unavailable or signed out, the control stays disabled and explains how to recover. Creating a PR from the default branch is refused; create a worktree first.

## Watch checks and merge

After a PR exists, the session bar reports checks as running, failing, or passing. Select the checks control for the native details popup and links to GitHub. AOP never embeds github.com in an iframe.

When GitHub reports that checks are satisfied and the PR is mergeable, the control becomes **Merge**. Squash is the default; merge commit and rebase are available from the adjacent menu. Every merge requires confirmation. AOP leaves the branch intact after merge.

Merges performed on GitHub are detected by background status refreshes. The merged bar links the PR and exposes author, date, diffstat, and file-count details. Dismissing it is remembered for that session and PR.
