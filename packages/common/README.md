# @aop/common

Shared types, Zod schemas, and constants for AOP apps and packages.

These shared contracts keep the workflow engine, Pool UI, CLI, and executor aligned on the same model: tasks move through statuses, workers provide capacity, workflow steps produce commands, and SSE events project concurrent runs back to the operator.

## Modules

| Area | Exports (examples) |
|------|---------------------|
| **Env** | `AOP_PORTS`, `AOP_URLS` — require `AOP_LOCAL_SERVER_PORT` / `AOP_LOCAL_SERVER_URL` at runtime |
| **Task** | `Task`, `TaskStatus` (`DRAFT`, `READY`, `WORKING`, `PAUSED`, `RESUMING`, `BLOCKED`, `DONE`, `REMOVED`) |
| **Protocol** | Workflow step commands, `TaskReadyResponse`, execution statuses |
| **SSE** | `SSETask`, capacity, repo/task dashboard events |
| **Create task** | Brainstorming request/response types for `/api/create-task` |
| **Workflow runtime** | Provider/model/reasoning options for step agent overrides |
| **Multi-agent** | Task execution model, repo assignments, coordination phases |
| **Factory health** | Health snapshot types for the pool UI |
| **Result** | `ok` / `err`, `parseBody` helpers |

## Task example

```typescript
import { Task, TaskStatus } from "@aop/common";

const task: Task = {
  id: "task_01h455vb4pex5vsknk084sn02q",
  repoId: "repo_01h455vb4pex5vsknk084sn02r",
  changePath: "docs/tasks/my-feature", // logical path for compatibility
  taskDocsPath: "~/.aop/repos/repo_.../tasks/my-feature", // optional on-disk hint
  worktreePath: null,
  status: TaskStatus.READY,
  baseBranch: "main",
  readyAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};
```

Canonical task files on disk use `~/.aop/repos/<repoId>/tasks/<slug>/` (see `@aop/infra` `aopPaths`).

## Scripts

```bash
bun run build
bun run typecheck
bun test
```
