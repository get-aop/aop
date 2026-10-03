import type { RuntimeConfigurationProvider, RuntimeStatus } from "@aop/common";
import type { ApiCall } from "../test/mock-api";

/** A runtime configuration whose models each take the listed effort levels. */
export const makeRuntime = (
  id: string,
  name: string,
  models: { model: string; description?: string; levels?: string[] }[],
  overrides: Partial<RuntimeConfigurationProvider> = {},
): RuntimeConfigurationProvider =>
  ({
    id,
    name,
    command: id === "claude-code" ? "claude" : `/opt/bin/${id}`,
    driver: "claude-code",
    builtIn: id === "claude-code",
    position: 0,
    supportsFastMode: false,
    models: models.map((model, position) => ({
      id: `${id}_${model.model}`,
      providerId: id,
      description: model.description ?? model.model,
      model: model.model,
      thinkingLevels: model.levels ?? ["low", "medium", "high"],
      builtIn: id === "claude-code",
      position,
      isDefault: position === 0,
      defaultThinkingLevel: null,
    })),
    ...overrides,
  }) as RuntimeConfigurationProvider;

/** What the host found for a runtime: ready, or not with `reason`. */
export const makeStatus = (runtimeId: string, reason: string | null = null): RuntimeStatus => ({
  runtimeId,
  path: reason ? null : `/opt/bin/${runtimeId}`,
  version: reason ? null : "1.0.0",
  auth: reason ? "unknown" : "logged-in",
  ready: reason === null,
  reason,
  checkedAt: "2026-10-03T00:00:00.000Z",
});

/** Answers the runtime reads a page makes (see `mockApi`); anything else is left to the caller. */
export const answerRuntimes =
  (state: {
    providers: RuntimeConfigurationProvider[];
    statuses?: RuntimeStatus[];
    defaultRuntimeId?: string;
  }) =>
  (call: ApiCall): Response | undefined => {
    if (call.method !== "GET") return undefined;
    if (call.path === "/runtime-configuration") {
      return Response.json({
        providers: state.providers,
        defaultRuntimeId: state.defaultRuntimeId ?? "claude-code",
      });
    }
    if (call.path.startsWith("/runtime-configuration/status")) {
      return Response.json({
        statuses: state.statuses ?? state.providers.map((runtime) => makeStatus(runtime.id)),
      });
    }
    return undefined;
  };
