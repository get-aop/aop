// Translate paths between Windows and WSL representations for the desktop ↔ sidecar seam.
//
// Guidance: under WSL, keep AOP_HOME and cloned repos INSIDE the distro filesystem
// (e.g. /home/<user>/.aop) rather than on /mnt/c. Cross-filesystem access over 9p is
// slow and has case/lock semantics that can corrupt git worktrees and SQLite.

const DRIVE_RE = /^([A-Za-z]):[\\/](.*)$/;
// \\wsl$\<distro>\... and \\wsl.localhost\<distro>\...
const WSL_UNC_RE = /^\\\\wsl(?:\$|\.localhost)\\([^\\]+)\\(.*)$/i;
const MNT_RE = /^\/mnt\/([a-z])(?:\/(.*))?$/i;

/** True when the input looks like a Windows path (drive-letter or UNC). */
export const isWindowsPath = (input: string): boolean =>
  DRIVE_RE.test(input) || input.startsWith("\\\\");

/**
 * Convert a Windows path to its WSL equivalent.
 * - `C:\Users\me\repo` → `/mnt/c/Users/me/repo`
 * - `\\wsl$\Ubuntu\home\me` (or `\\wsl.localhost\...`) → `/home/me`
 * Idempotent: an already-WSL path is returned unchanged.
 */
export const windowsToWsl = (input: string): string => {
  if (input.startsWith("/")) {
    return input;
  }

  const unc = input.match(WSL_UNC_RE);
  if (unc) {
    const segments = (unc[2] ?? "").split("\\").filter(Boolean);
    return `/${segments.join("/")}`;
  }

  const drive = input.match(DRIVE_RE);
  if (drive) {
    const letter = (drive[1] ?? "").toLowerCase();
    const segments = (drive[2] ?? "").split(/[\\/]/).filter(Boolean);
    return segments.length > 0 ? `/mnt/${letter}/${segments.join("/")}` : `/mnt/${letter}`;
  }

  return input.replace(/\\/g, "/");
};

/**
 * Convert a WSL path to its Windows equivalent.
 * - `/mnt/c/Users/me/repo` → `C:\Users\me\repo`
 * - `/home/me` + distro `Ubuntu` → `\\wsl$\Ubuntu\home\me`
 * Distro-internal paths require `distro`; without it they are returned unchanged.
 * Idempotent: an already-Windows path is returned unchanged.
 */
export const wslToWindows = (input: string, distro?: string): string => {
  if (isWindowsPath(input)) {
    return input;
  }

  const mnt = input.match(MNT_RE);
  if (mnt) {
    const letter = (mnt[1] ?? "").toUpperCase();
    const rest = (mnt[2] ?? "").split("/").filter(Boolean).join("\\");
    return rest ? `${letter}:\\${rest}` : `${letter}:\\`;
  }

  if (input.startsWith("/") && distro) {
    const rest = input.split("/").filter(Boolean).join("\\");
    return `\\\\wsl$\\${distro}\\${rest}`;
  }

  return input;
};
