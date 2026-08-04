# Create pull request

## What you see

A **Done** task opens the **Create pull request** dialog. AOP pushes the task branch, opens a PR on GitHub, and optionally auto-generates the description from your task docs. After creation, the dialog switches to **Pull request checks** so you can watch CI status.

## Why it matters

- **One-click handoff** - No manual `git push` + `gh pr create` copy-paste from the worktree.
- **Pipeline output becomes review input** - AOP carries task docs, plan, and acceptance criteria into the PR instead of forcing you to reconstruct the story.
- **Docs-driven PR body** - Leave the description blank and AOP builds it from specs, plan, and acceptance criteria.
- **Branch safety** - Uses the task's derived branch name and validates commits exist before opening the PR.
- **Checks in context** - See PR check status without leaving the dashboard.

## How to try it

1. Run a task through a [workflow](./run-workflow.md) to completion.
2. Install and authenticate the [GitHub CLI](https://cli.github.com/) (`gh auth login`).
3. Click **Create PR** on the card or task detail, add an optional comment, and submit.
4. When checks finish, use [Fix CI](./fix-ci.md) if anything fails.

[← Back to product tour](./README.md)
