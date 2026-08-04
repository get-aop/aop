export type OpenExternalPlatform = NodeJS.Platform;

export type SpawnExternalCommand = (command: string[]) => {
  unref?: () => void;
};

const LOOPBACK_HOSTS = new Set(["localhost", "aop.localhost", "127.0.0.1", "::1"]);

export const isAllowedExternalUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

/** True when running as a Linux process inside WSL (where xdg-open and a Linux browser are absent). */
export const isRunningInWsl = (env: Record<string, string | undefined> = process.env): boolean =>
  Boolean(env.WSL_DISTRO_NAME) || Boolean(env.WSL_INTEROP);

export const buildOpenExternalCommand = (
  url: string,
  platform: OpenExternalPlatform = process.platform,
  insideWsl: boolean = isRunningInWsl(),
): string[] | null => {
  if (platform === "darwin") return ["open", url];
  if (platform === "linux") {
    // Inside WSL there is no xdg-open and no Linux browser; hand the URL to the Windows
    // host via explorer.exe so it opens in the default Windows browser.
    return insideWsl ? ["explorer.exe", url] : ["xdg-open", url];
  }
  if (platform === "win32") return ["rundll32.exe", "url.dll,FileProtocolHandler", url];
  return null;
};

export const openExternalUrl = async (
  url: string,
  options: {
    platform?: OpenExternalPlatform;
    spawn?: SpawnExternalCommand;
  } = {},
): Promise<void> => {
  if (!isAllowedExternalUrl(url)) {
    throw new Error("Only https URLs and loopback http URLs can be opened.");
  }

  const command = buildOpenExternalCommand(url, options.platform);
  if (!command) {
    throw new Error(
      `Opening external URLs is not supported on ${options.platform ?? process.platform}.`,
    );
  }

  const spawn = options.spawn ?? spawnExternalCommand;
  spawn(command).unref?.();
};

const spawnExternalCommand: SpawnExternalCommand = (command) =>
  Bun.spawn(command, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
