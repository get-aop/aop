import { CUA_DRIVER_VERSION } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { CuaThread } from "../cua-activity.ts";
import type { CuaLease } from "../lease.ts";
import { driverAction, findDriver, type InstalledDriver, installDriver } from "./driver-install.ts";
import { hostSystem, type SetupSystem } from "./system.ts";

const logger = getLogger("computer-use");

export type AutoUpgrade = "off" | "none" | "upgraded" | "failed";

/**
 * Who holds the computer-use lease while the driver is swapped: the host itself, under a name the
 * live view and the lease list show. It is not a thread; threads waiting for the screen queue
 * behind it as they would behind one.
 */
export const DRIVER_SWAP_HOLDER: CuaThread = {
  id: "aop-host:cua-driver-upgrade",
  projectId: "",
  title: "AOP: updating CUA Driver",
};

/** How long one wait for the lease lasts before it asks again, keeping its place in line. */
const LEASE_WAIT_MS = 60_000;

/**
 * The CUA Driver ships pinned with the host, so a host update can pin a newer one. On boot the
 * host brings an installed driver that is older than the pin up to it, with the same user-level
 * installer setup runs (no sudo, no prompt). The swap waits until no thread holds computer use
 * and holds the lease itself meanwhile (`lease`), so a thread never has its driver replaced under
 * it and threads that want the screen queue behind the swap. It never installs a driver nobody
 * installed, never repairs one (a person should see why it broke), and leaves a newer one alone.
 * The other steps of `aop computer-use setup` (system packages need sudo; the virtual screen) are
 * not run here: the Host checklist reports what is missing, with the command to run.
 * `AOP_CUA_AUTO_UPGRADE=0` turns it off; so does a driver named by `AOP_CUA_DRIVER` (an isolated
 * stack's own build).
 */
export const upgradePinnedDriver = async (
  sys: SetupSystem = hostSystem(),
  lease?: () => CuaLease,
): Promise<AutoUpgrade> => {
  if (upgradeOff(sys)) return "off";
  const installed = await findDriver(sys);
  if (driverAction(installed, CUA_DRIVER_VERSION) !== "upgrade") return "none";
  return holdingLease(lease?.(), () => upgrade(sys, installed));
};

const upgradeOff = (sys: SetupSystem): boolean =>
  sys.env.AOP_CUA_AUTO_UPGRADE === "0" ||
  Boolean(sys.env.AOP_CUA_DRIVER) ||
  sys.env.NODE_ENV === "test" ||
  (sys.platform !== "linux" && sys.platform !== "darwin");

const upgrade = async (
  sys: SetupSystem,
  installed: InstalledDriver | null,
): Promise<AutoUpgrade> => {
  logger.info("Upgrading CUA Driver {from} to {to}, the version this AOP pins", {
    from: installed?.version ?? "unknown",
    to: CUA_DRIVER_VERSION,
  });
  const result = await installDriver(sys, CUA_DRIVER_VERSION, { interactive: false });
  if (!result.ok) {
    logger.warn("Upgrading CUA Driver failed: {output}", { output: result.output.slice(-2_000) });
    return "failed";
  }
  // The installer stops the macOS app to swap it; it holds the permissions, so it comes back.
  if (sys.platform === "darwin")
    await sys.run(["open", "-n", "-g", "-a", "CuaDriver", "--args", "serve"]);
  return "upgraded";
};

// The swap counts as one long call, so the lease's idle timeout never hands the screen on
// halfway through it.
const holdingLease = async <T>(lease: CuaLease | undefined, run: () => Promise<T>): Promise<T> => {
  if (!lease) return run();
  await waitForLease(lease);
  lease.callStarted(DRIVER_SWAP_HOLDER.id);
  try {
    return await run();
  } finally {
    lease.callEnded(DRIVER_SWAP_HOLDER.id);
    await lease.release(DRIVER_SWAP_HOLDER.id, "end-session");
  }
};

const waitForLease = async (lease: CuaLease): Promise<void> => {
  let logged = false;
  for (;;) {
    const result = await lease.acquire(DRIVER_SWAP_HOLDER, { maxWaitMs: LEASE_WAIT_MS });
    if (result.kind === "granted") return;
    if (!logged) {
      logger.info("CUA Driver upgrade waits for the thread using computer use to finish");
      logged = true;
    }
  }
};
