import type { RuntimeConfigurationProvider as RuntimeConfigurationProviderRecord } from "@aop/common";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { getRuntimeConfiguration } from "../api/client";

interface RuntimeConfigurationContextValue {
  providers: RuntimeConfigurationProviderRecord[];
  refresh: () => Promise<void>;
}

const RuntimeConfigurationContext = createContext<RuntimeConfigurationContextValue>({
  providers: [],
  refresh: async () => undefined,
});

export const RuntimeConfigurationProvider = ({ children }: { children: ReactNode }) => {
  const [providers, setProviders] = useState<RuntimeConfigurationProviderRecord[]>([]);

  const refresh = useCallback(async () => {
    try {
      setProviders(await getRuntimeConfiguration());
    } catch {
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <RuntimeConfigurationContext.Provider value={{ providers, refresh }}>
      {children}
    </RuntimeConfigurationContext.Provider>
  );
};

export const useRuntimeConfiguration = (): RuntimeConfigurationContextValue =>
  useContext(RuntimeConfigurationContext);
