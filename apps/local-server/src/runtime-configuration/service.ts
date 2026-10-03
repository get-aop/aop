import {
  BUILT_IN_RUNTIME_ID,
  type RuntimeConfigurationProvider,
  type RuntimeStatus,
  type RuntimeUsage,
} from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { RuntimeUsers } from "../project/runtime-users.ts";
import { SettingKey } from "../settings/types.ts";
import { readDefaultRuntimeId } from "./default-runtime.ts";
import { hostRuntimeReadiness, type RuntimeReadiness } from "./readiness.ts";
import { createRuntimeConfigurationRepository } from "./repository.ts";

export type RemoveRuntimeError =
  | { code: "RUNTIME_NOT_FOUND" }
  | { code: "RUNTIME_IN_USE"; usage: RuntimeUsage[] };

export interface RuntimeConfigurationService {
  /** Every runtime, built-in first, and the one new projects start on. */
  list: () => Promise<{ providers: RuntimeConfigurationProvider[]; defaultRuntimeId: string }>;
  /** What the host finds for every runtime; `fresh` looks again instead of using recent looks. */
  statuses: (options?: { fresh?: boolean }) => Promise<RuntimeStatus[]>;
  setDefault: (
    runtimeId: string,
  ) => Promise<
    | { success: true; defaultRuntimeId: string }
    | { success: false; error: { code: "RUNTIME_NOT_FOUND" } }
  >;
  /** The projects that name the runtime or have open threads on it: what removing it would move. */
  usage: (runtimeId: string) => Promise<RuntimeUsage[]>;
  /**
   * Removes a custom runtime. One a project names, or that open threads run on, is refused with
   * the list, unless `moveToDefault` moves them to the host's default first (to the built-in one
   * when the default is the runtime going). Sessions still bound to it follow the same way, so no
   * session is left naming a runtime that is gone; a default that was it falls back to built-in.
   */
  remove: (
    runtimeId: string,
    options?: { moveToDefault?: boolean },
  ) => Promise<{ success: true } | { success: false; error: RemoveRuntimeError }>;
}

export const createRuntimeConfigurationService = (
  ctx: LocalServerContext,
  users: RuntimeUsers,
  readiness: RuntimeReadiness = hostRuntimeReadiness(),
): RuntimeConfigurationService => {
  const repository = createRuntimeConfigurationRepository(ctx.db);

  // Everything still on a runtime that is going moves to the host's default, or to the built-in
  // one when the default is the runtime going (and the default becomes the built-in one).
  const moveOff = async (runtimeId: string): Promise<void> => {
    const defaultRuntimeId = await readDefaultRuntimeId(ctx, repository);
    const isDefault = defaultRuntimeId === runtimeId;
    const target = await repository.get(isDefault ? BUILT_IN_RUNTIME_ID : defaultRuntimeId);
    if (target) await users.move(runtimeId, { id: target.id, command: target.command });
    if (isDefault)
      await ctx.settingsRepository.set(SettingKey.DEFAULT_RUNTIME, BUILT_IN_RUNTIME_ID);
  };

  return {
    list: async () => ({
      providers: await repository.list(),
      defaultRuntimeId: await readDefaultRuntimeId(ctx, repository),
    }),

    statuses: async (options = {}) =>
      Promise.all((await repository.list()).map((provider) => readiness.check(provider, options))),

    setDefault: async (runtimeId) => {
      if (!(await repository.get(runtimeId))) {
        return { success: false, error: { code: "RUNTIME_NOT_FOUND" } };
      }
      await ctx.settingsRepository.set(SettingKey.DEFAULT_RUNTIME, runtimeId);
      return { success: true, defaultRuntimeId: runtimeId };
    },

    usage: (runtimeId) => users.list(runtimeId),

    remove: async (runtimeId, options = {}) => {
      const runtime = await repository.get(runtimeId);
      if (!runtime || runtime.builtIn) {
        return { success: false, error: { code: "RUNTIME_NOT_FOUND" } };
      }
      const usage = await users.list(runtimeId);
      if (usage.length > 0 && !options.moveToDefault) {
        return { success: false, error: { code: "RUNTIME_IN_USE", usage } };
      }
      await moveOff(runtimeId);
      await repository.deleteProvider(runtimeId);
      return { success: true };
    },
  };
};
