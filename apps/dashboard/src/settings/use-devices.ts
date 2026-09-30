import type { Device } from "@aop/common";
import { useCallback, useEffect, useState } from "react";
import { listDevices, revokeDevice } from "../api/auth";

export interface DevicesState {
  /** Newest pairing last, as the host lists them; null until the first load. */
  devices: Device[] | null;
  error: string | null;
  /** Rejects with the host's message; the row leaves the list once the host has revoked it. */
  revoke: (device: Device) => Promise<void>;
}

const POLL_MS = 5_000;

/**
 * The paired devices. The list is read again every few seconds, so a device that just paired
 * with the code on screen, or that was last seen a moment ago, shows without a reload.
 */
export const useDevices = (pollMs: number = POLL_MS): DevicesState => {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      listDevices().then(
        (loaded) => {
          setDevices(loaded);
          setError(null);
        },
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not load the devices");
        },
      ),
    [],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  const revoke = useCallback(async (device: Device) => {
    await revokeDevice(device.id);
    setDevices((current) => (current ?? []).filter((candidate) => candidate.id !== device.id));
  }, []);

  return { devices, error, revoke };
};
