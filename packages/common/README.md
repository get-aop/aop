# @aop/common

Shared types, Zod schemas, and constants for AOP apps and packages. Consumers import from the `@aop/common` barrel (`src/index.ts`), never from a deep path.

## Modules

| Area | Exports (examples) | Source |
|------|--------------------|--------|
| **Env** | `AOP_PORTS`, `AOP_URLS` — require `AOP_LOCAL_SERVER_PORT` / `AOP_LOCAL_SERVER_URL` at runtime | `src/env.ts` |
| **Projects** | `Project`, `Thread` (a union on `status`), `Message` with `MessageBlock[]`, `EventLogEntry`, `Device`, and the runtime selection types (`CliProvider`, `ReasoningEffort`) | `src/projects/` |
| **Runtime catalog** | Static provider/model/effort table: `CLI_PROVIDER_LABELS`, `getRuntimeModelOptions`, `getThinkingOptions`, `supportsFastMode`, `getDefaultRuntimeModel` | `src/types/runtime-catalog.ts` |
| **Runtime configuration** | `RuntimeConfigurationProvider`, `RuntimeProfile`, built-in configurations, thinking-level defaults | `src/types/runtime-configuration.ts`, `runtime-profile.ts` |
| **Chat sessions** | `ChatSessionSummary`, `UpdateChatSessionInput`, `ChatDocumentAttachment`, `ChatImageAttachment` with `CHAT_DOCUMENT_LIMITS` and `CHAT_IMAGE_LIMITS`, delegation and control-command markers | `src/types/chat-*.ts`, `control-command.ts`, `runtime-delegation.ts` |
| **Session git** | Branch, diff, and pull request wire types | `src/types/session-git.ts` |
| **SSE** | `SSEInitEvent`, `SSERepoRemovedEvent`, `SSEDataResetEvent`, `SSEChatUnreadEvent` | `src/types/sse-events.ts` |
| **Updates** | `AopUpdateStatus`, release-version helpers | `src/types/updates.ts`, `src/version.ts` |
| **Execution hosts** | `ExecHostConfig` and its schemas | `src/types/exec-host-config.ts` |

## Scripts

```bash
bun run build
bun run typecheck
bun test
```
