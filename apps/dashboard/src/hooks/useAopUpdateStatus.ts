import type { AopUpdateStatus } from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { getUpdateStatus } from "../api/client";
import { runUpdateInstall } from "./run-update-install";

const UPDATE_POLL_INTERVAL_MS = 30 * 60 * 1000;

const isActiveWatch = (watchId: number, restartWatchRef: { current: number }): boolean =>
  restartWatchRef.current === watchId;

export const useAopUpdateStatus = ({ poll = true }: { poll?: boolean } = {}) => {
  const [status, setStatus] = useState<AopUpdateStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [awaitingRestart, setAwaitingRestart] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const restartWatchRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await getUpdateStatus();
      setStatus(nextStatus);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!poll) return;

    const intervalId = window.setInterval(() => {
      void refresh();
    }, UPDATE_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [poll, refresh]);

  useEffect(
    () => () => {
      restartWatchRef.current += 1;
    },
    [],
  );

  const install = useCallback(async () => {
    const watchId = restartWatchRef.current + 1;
    restartWatchRef.current = watchId;

    setInstalling(true);
    setAwaitingRestart(false);
    setInstallError(null);
    setInstallMessage(null);

    await runUpdateInstall(watchId, (id) => isActiveWatch(id, restartWatchRef), {
      onStarted: (message) => {
        setInstallMessage(message);
        setAwaitingRestart(true);
      },
      onTimeout: () => {
        setInstallError("Update is taking longer than expected. Refresh when AOP is back online.");
        setInstalling(false);
        setAwaitingRestart(false);
      },
      onError: (message) => {
        setInstallError(message);
        setInstalling(false);
        setAwaitingRestart(false);
      },
    });
  }, []);

  return {
    status,
    installing,
    awaitingRestart,
    installError,
    installMessage,
    refresh,
    install,
  };
};
