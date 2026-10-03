import { CUA_DRIVER_VERSION } from "@aop/common";
import { getLogger } from "@aop/infra";
import { driverAction, findDriver, installDriver } from "./driver-install.ts";
import { hostSystem, type SetupSystem } from "./system.ts";

const logger = getLogger("computer-use");

export type AutoUpgrade = "off" | "none" | "upgraded" | "failed";

/**
 * A host update can pin a newer CUA Driver. On boot the host brings an installed driver that is
 * older than the pin up to it, with the same user-level installer setup runs (no sudo, no
 * prompt). It never installs a driver nobody installed, never repairs one (a person should see
 * why it broke), and leaves a newer one alone. `AOP_CUA_AUTO_UPGRADE=0` turns it off; so does a
 * driver named by `AOP_CUA_DRIVER` (an isolated stack's own build).
 */
export const upgradePinnedDriver = async (
  sys: SetupSystem = hostSystem(),
): Promise<AutoUpgrade> => {
  if (
    sys.env.AOP_CUA_AUTO_UPGRADE === "0" ||
    sys.env.AOP_CUA_DRIVER ||
    sys.env.NODE_ENV === "test"
  ) {
    return "off";
  }
  if (sys.platform !== "linux" && sys.platform !== "darwin") return "off";
  const installed = await findDriver(sys);
  if (driverAction(installed, CUA_DRIVER_VERSION) !== "upgrade") return "none";
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
