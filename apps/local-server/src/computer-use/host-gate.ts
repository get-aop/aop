import { driverEnv } from "./config.ts";
import { createDriverClient, spawnDriverProcess } from "./driver-client.ts";
import { createDriverPool, type DriverPool } from "./driver-pool.ts";
import { hostExternalLock } from "./external-lock.ts";
import { type CuaLease, createCuaLease } from "./lease.ts";
import { type CuaGate, createCuaGate, MAX_WAIT_MS } from "./mcp-gate.ts";
import { type ComputerUseService, computerUse } from "./service.ts";

/** The host's one lease, driver pool and gate, made on first use (tests make their own). */
export interface HostCua {
  lease: CuaLease;
  pool: DriverPool;
  gate: CuaGate;
}

let host: HostCua | null = null;

export const hostCua = (service: ComputerUseService = computerUse): HostCua => {
  if (host) return host;
  const lease = createCuaLease({ externalLock: hostExternalLock() });
  const pool = createDriverPool(async () => {
    const status = await service.cuaStatus();
    if (status.status !== "ready" || !status.path) return null;
    return createDriverClient(spawnDriverProcess(status.path, driverEnv()));
  });
  lease.setCleanup((threadId) => pool.endThread(threadId));
  const gate = createCuaGate({ lease, pool, maxWaitMs: maxWaitFromEnv() });
  host = { lease, pool, gate };
  return host;
};

/** Whether the host's lease exists yet: run ends need not create it just to say nothing. */
export const hostCuaStarted = (): HostCua | null => host;

/** Ends what the lease and the drivers hold (host shutdown). */
export const stopHostCua = async (): Promise<void> => {
  if (!host) return;
  const { lease, pool } = host;
  host = null;
  lease.stop();
  await pool.closeAll();
};

// An isolated stack can shorten how long one call waits, to see the "still waiting" answer.
const maxWaitFromEnv = (): number => {
  const value = Number(process.env.AOP_CUA_MAX_WAIT_MS);
  return Number.isFinite(value) && value > 0 ? value : MAX_WAIT_MS;
};

/** A thread's run ended (done, stopped or crashed): its lease, place in line and driver go. */
export const cuaRunEnded = async (threadId: string): Promise<void> => {
  const started = hostCuaStarted();
  if (!started) return;
  await started.lease.runEnded(threadId);
  await started.pool.endThread(threadId);
};
