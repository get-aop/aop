# @aop/git-manager

Git worktree lifecycle management for thread isolation. Enables parallel agent work through isolated filesystems.

This package is what lets several threads of one project work in the same repository at once. Each thread receives its own worktree on its own branch, so one thread's edits never reach another thread or the person's own checkout.

## Installation

```bash
bun add @aop/git-manager
```

## Usage

```typescript
import { GitManager } from "@aop/git-manager";

const manager = new GitManager({ repoPath: "/path/to/repo", repoId: "repo_abc" });
await manager.init();

// Create an isolated worktree for a thread
const worktree = await manager.createWorktree("isess_123", "main", "aop/add-auth-abc123");
// The worktree lives under ~/.aop/worktrees/<repo-id>/<thread-id>/
// worktree.branch = "aop/add-auth-abc123"
// worktree.baseBranch = "main"
// worktree.baseCommit = "abc123..."

// Clean up when done
await manager.removeWorktree("isess_123");
```
