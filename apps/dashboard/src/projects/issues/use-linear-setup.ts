import type { LinearCatalog, LinearConnection, LinearScope } from "@aop/common";
import { useCallback, useEffect, useState } from "react";
import {
  connectLinear,
  disconnectLinear,
  getLinearCatalog,
  getLinearConnection,
} from "../../api/issues";

export type LinearSetupStep =
  /** Reading the connection. */
  | { kind: "loading" }
  | { kind: "connected" }
  /** Asking for a key: a first connection, or a new key for one. */
  | { kind: "key" }
  /** Picking the team or project, with what the key can see. */
  | { kind: "scope"; catalog: LinearCatalog; apiKey: string | null };

export interface LinearSetup {
  connection: LinearConnection | null;
  step: LinearSetupStep;
  busy: boolean;
  error: string | null;
  /** Checks a key with Linear and moves on to picking a team or project. */
  checkKey: (apiKey: string) => Promise<void>;
  /** Picks a new team or project for the key already stored. */
  changeScope: () => Promise<void>;
  replaceKey: () => void;
  save: (scope: LinearScope) => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  back: () => void;
}

/**
 * The steps of connecting a project to Linear, while the dialog is open. The key the person
 * pastes goes to the host once to list what it can see and once more to be saved; the host
 * never sends it back, so a stored key is never in this state.
 */
export const useLinearSetup = (projectId: string, open: boolean): LinearSetup => {
  const [connection, setConnection] = useState<LinearConnection | null>(null);
  const [step, setStep] = useState<LinearSetupStep>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setStep({ kind: "loading" });
    setError(null);
    getLinearConnection(projectId).then(
      (read) => {
        if (!current) return;
        setConnection(read);
        setStep({ kind: read.configured ? "connected" : "key" });
      },
      (cause) => {
        if (!current) return;
        setError(messageOf(cause));
        setStep({ kind: "key" });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, open]);

  const run = useCallback(async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (cause) {
      setError(messageOf(cause));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    connection,
    step,
    busy,
    error,
    checkKey: async (apiKey) => {
      const catalog = await run(() => getLinearCatalog(projectId, apiKey));
      if (catalog) setStep({ kind: "scope", catalog, apiKey });
    },
    changeScope: async () => {
      const catalog = await run(() => getLinearCatalog(projectId));
      if (catalog) setStep({ kind: "scope", catalog, apiKey: null });
    },
    replaceKey: () => {
      setError(null);
      setStep({ kind: "key" });
    },
    save: async (scope) => {
      const apiKey = step.kind === "scope" ? step.apiKey : null;
      const saved = await run(() =>
        connectLinear(projectId, { apiKey: apiKey ?? undefined, scope }),
      );
      if (!saved) return false;
      setConnection(saved);
      setStep({ kind: "connected" });
      return true;
    },
    disconnect: async () => {
      const done = await run(async () => {
        await disconnectLinear(projectId);
        return true;
      });
      if (!done) return false;
      setConnection({ configured: false, scope: null, workspace: null, viewer: null });
      setStep({ kind: "key" });
      return true;
    },
    back: () => {
      setError(null);
      setStep({ kind: connection?.configured ? "connected" : "key" });
    },
  };
};

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
