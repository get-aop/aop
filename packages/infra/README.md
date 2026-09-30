# @aop/infra

Shared infrastructure for AOP apps: logging, tracing, TypeIDs, subprocess spawning, and canonical paths under `~/.aop/`.

AOP's state has to be predictable across restarts and across the clients that reach one host. Worktrees, logs, and the SQLite database all live under the same path model, so a project's threads can run side by side without stepping on each other.

## Logger

Structured logging with pretty console (dev) or JSON (servers). Optional file sinks.

```ts
import { configureLogging, getLogger } from "@aop/infra";

await configureLogging({ level: "info" });
const logger = getLogger("aop", "local-server");
logger.info("Thread {threadId} started", { threadId: "isess_abc" });
```

## Tracing

`initTracing(serviceName)` installs an in-memory OpenTelemetry provider. The local server passes `getTracerProvider()` to its HTTP middleware, and the logger adds the active trace and span ids to each record.

## AOP data paths

```ts
import { aopPaths } from "@aop/infra";

aopPaths.home();                        // ~/.aop (or AOP_HOME)
aopPaths.db();                          // ~/.aop/projects.sqlite
aopPaths.logs();                        // ~/.aop/logs
aopPaths.worktree(repoId, threadId);    // ~/.aop/worktrees/<repo-id>/<thread-id>/
aopPaths.projectDir(projectId);         // ~/.aop/projects/<project-id>/
aopPaths.generalChatWorkspace();        // ~/.aop/chats/general
```

Used by local-server and the worktree manager for a consistent layout.

## TypeID

```ts
import { generateTypeId } from "@aop/infra";

generateTypeId("proj");   // proj_01h4...
generateTypeId("repo");
generateTypeId("isess");  // chat sessions, threads included
```

## Scripts

```bash
bun run build
bun run typecheck
bun test
```
