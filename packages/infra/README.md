# @aop/infra

Shared infrastructure for AOP apps: logging, tracing helpers, TypeIDs, and canonical paths under `~/.aop/`.

AOP's workflow automation depends on predictable local state. Task docs, worktrees, logs, agent metadata, and the SQLite database all live under the same path model so several workers can run without stepping on each other.

## Logger

Structured logging with pretty console (dev) or JSON (servers). Optional file sinks.

```ts
import { configureLogging, getLogger } from "@aop/infra";

await configureLogging({ level: "info" });
const logger = getLogger("aop", "orchestrator");
logger.info("Task {taskId} started", { taskId: "task_abc" });
```

## AOP data paths

```ts
import { aopPaths } from "@aop/infra";

aopPaths.home();                    // ~/.aop (or AOP_HOME)
aopPaths.db();                      // ~/.aop/aop.sqlite
aopPaths.repoTasks(repoId);         // ~/.aop/repos/<id>/tasks/
aopPaths.worktree(repoId, taskId);  // ~/.aop/worktrees/<id>/<taskId>/
aopPaths.agent(agentId);            // ~/.aop/agents/<id>/
```

Used by local-server, executor, and install scripts for consistent layout.

## TypeID

```ts
import { generateTypeId } from "@aop/infra";

generateTypeId("task");  // task_01h4...
generateTypeId("repo");
generateTypeId("agent");
```

## Scripts

```bash
bun run build
bun run typecheck
bun test
```
