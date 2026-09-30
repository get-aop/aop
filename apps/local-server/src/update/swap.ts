import { copyFile, link, rename, rm, stat } from "node:fs/promises";
import type { InstallLayout } from "./install-layout.ts";
import type { StagedRelease } from "./stage.ts";

/** The new release is in place and the old one is kept aside until the new one has proven itself. */
export interface Swapped {
  /** Puts the old binary and dashboard back. */
  rollback: () => Promise<void>;
  /** The new release worked: drops the old one. */
  commit: () => Promise<void>;
}

/**
 * Moves a staged release into the install. The binary is replaced by a rename, so there is
 * never a moment without an `aop` file, and a running host keeps the file it started from.
 * The previous binary is kept as a hard link to its old file, which costs no copy.
 */
export const swapIn = async (staged: StagedRelease, layout: InstallLayout): Promise<Swapped> => {
  const previousBinary = `${layout.binaryPath}.previous`;
  const previousDashboard = `${layout.dashboardDir}.previous`;
  await rm(previousBinary, { force: true });
  await rm(previousDashboard, { recursive: true, force: true });

  const hadDashboard = await exists(layout.dashboardDir);
  const swapped: Swapped = {
    rollback: async () => {
      await restore(layout, previousBinary, previousDashboard, hadDashboard);
      await rm(staged.dir, { recursive: true, force: true });
    },
    commit: async () => {
      await rm(previousBinary, { force: true });
      await rm(previousDashboard, { recursive: true, force: true });
      await rm(staged.dir, { recursive: true, force: true });
    },
  };

  await keepBinary(layout.binaryPath, previousBinary);
  try {
    if (hadDashboard) await rename(layout.dashboardDir, previousDashboard);
    await rename(staged.dashboard, layout.dashboardDir);
    await rename(staged.binary, layout.binaryPath);
  } catch (error) {
    await swapped.rollback();
    throw error;
  }
  return swapped;
};

const keepBinary = async (binaryPath: string, previousBinary: string): Promise<void> => {
  try {
    await link(binaryPath, previousBinary);
  } catch {
    await copyFile(binaryPath, previousBinary);
  }
};

const restore = async (
  layout: InstallLayout,
  previousBinary: string,
  previousDashboard: string,
  hadDashboard: boolean,
): Promise<void> => {
  if (await exists(previousBinary)) await rename(previousBinary, layout.binaryPath);
  if (!hadDashboard) {
    await rm(layout.dashboardDir, { recursive: true, force: true });
  } else if (await exists(previousDashboard)) {
    await rm(layout.dashboardDir, { recursive: true, force: true });
    await rename(previousDashboard, layout.dashboardDir);
  }
};

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );
