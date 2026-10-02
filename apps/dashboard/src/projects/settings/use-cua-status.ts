import type { CuaStatus } from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCuaStatus } from "../../api/computer-use";

export interface CuaStatusState {
  /** Null until the host answers, and when it could not be asked. */
  status: CuaStatus | null;
  checking: boolean;
  /** Probes the host's CUA Driver again, past the few seconds the host reuses an answer. */
  recheck: () => void;
}

/** CUA Driver as the host sees it, asked once when the settings open and again on request. */
export const useCuaStatus = (): CuaStatusState => {
  const [status, setStatus] = useState<CuaStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async (fresh: boolean) => {
    setChecking(true);
    const next = await getCuaStatus(fresh).catch(() => null);
    if (!mounted.current) return;
    setStatus(next);
    setChecking(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load(false);
    return () => {
      mounted.current = false;
    };
  }, [load]);

  return { status, checking, recheck: () => void load(true) };
};
