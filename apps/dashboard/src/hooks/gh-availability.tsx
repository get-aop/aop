import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { getFactoryHealth } from "../api/client";

/**
 * Whether the GitHub `gh` CLI is available. Defaults to `true` so a failed or
 * pending health fetch never locks the operator out of git actions — the
 * server-side checks remain the source of truth for actual execution.
 */
const GhAvailabilityContext = createContext<boolean>(true);

export const useGhAvailability = (): boolean => useContext(GhAvailabilityContext);

/**
 * Derives gh availability from the factory-health snapshot's `github-cli`
 * integration item (the same source that drives the header alert icon) and
 * shares it with every git/PR control so they can disable in lockstep.
 */
export const GhAvailabilityProvider = ({ children }: { children: ReactNode }) => {
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void getFactoryHealth()
      .then((snapshot) => {
        if (cancelled) return;
        const unavailable = snapshot.integrations.some(
          (item) => item.id === "github-cli" && item.severity === "error",
        );
        setAvailable(!unavailable);
      })
      .catch(() => {
        // Keep the default (available) — never block git actions on a health hiccup.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GhAvailabilityContext.Provider value={available}>{children}</GhAvailabilityContext.Provider>
  );
};

/** Exposed for tests to render consumers with an explicit availability value. */
export const GhAvailabilityTestProvider = GhAvailabilityContext.Provider;
