import {
  BUILT_IN_RUNTIME_ID,
  type RuntimeConfigurationProvider as RuntimeConfigurationProviderRecord,
  type RuntimeStatus,
} from "@aop/common";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { getRuntimeConfigurationState, getRuntimeStatuses } from "../api/client";

interface RuntimeConfigurationContextValue {
  providers: RuntimeConfigurationProviderRecord[];
  /** The runtime new projects start on. */
  defaultRuntimeId: string;
  /** What the host found for each runtime, by id; null until the first look comes back. */
  statuses: Record<string, RuntimeStatus> | null;
  /** Reads the runtimes and the default again, then their statuses. */
  refresh: () => Promise<void>;
  /** Reads the statuses again; `fresh` makes the host look at every command now. */
  refreshStatuses: (fresh?: boolean) => Promise<void>;
}

const RuntimeConfigurationContext = createContext<RuntimeConfigurationContextValue>({
  providers: [],
  defaultRuntimeId: BUILT_IN_RUNTIME_ID,
  statuses: null,
  refresh: async () => undefined,
  refreshStatuses: async () => undefined,
});

export const RuntimeConfigurationProvider = ({ children }: { children: ReactNode }) => {
  const [providers, setProviders] = useState<RuntimeConfigurationProviderRecord[]>([]);
  const [defaultRuntimeId, setDefaultRuntimeId] = useState(BUILT_IN_RUNTIME_ID);
  const [statuses, setStatuses] = useState<Record<string, RuntimeStatus> | null>(null);

  const refreshStatuses = useCallback(async (fresh = false) => {
    try {
      const list = await getRuntimeStatuses(fresh);
      setStatuses(Object.fromEntries(list.map((status) => [status.runtimeId, status])));
    } catch {
      // Statuses only grey out runtimes that cannot run; without them every runtime is offered.
      setStatuses((current) => current ?? {});
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const state = await getRuntimeConfigurationState();
      setProviders(state.providers);
      setDefaultRuntimeId(state.defaultRuntimeId);
    } catch {
      setProviders([]);
    }
    await refreshStatuses();
  }, [refreshStatuses]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <RuntimeConfigurationContext.Provider
      value={{ providers, defaultRuntimeId, statuses, refresh, refreshStatuses }}
    >
      {children}
    </RuntimeConfigurationContext.Provider>
  );
};

export const useRuntimeConfiguration = (): RuntimeConfigurationContextValue =>
  useContext(RuntimeConfigurationContext);
