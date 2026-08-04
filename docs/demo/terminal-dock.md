# Terminal dock

![AOP dashboard](https://raw.githubusercontent.com/get-aop/aop/main/docs/screenshots/hero.png)

## What you see

The terminal is a full-width dock at the bottom of the workspace (VS Code style), toggled by the **Terminal** button in the top bar or **⌘J**. Its header shows repo, worktree, and branch in mono; the dock resizes vertically and remembers the layout per session.

## Why it matters

- **Always-darkest surface** — terminal output is visually distinct from the thread.
- **Per-session state** — each session keeps its own dock content and input history.
- **One shortcut** — ⌘J opens and closes the dock without leaving the keyboard.

## How to try it

1. Press **⌘J** (or click the terminal button in the session top bar).
2. Run `git status` or any shell command in the session workspace.
3. Drag the dock's top edge to resize it.
4. Switch sessions and back — the dock keeps its state per session.

[← Back to product tour](./README.md)
