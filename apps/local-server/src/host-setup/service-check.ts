import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ChannelConfig, SetupCheck } from "@aop/common";
import type { ServiceLook } from "./probes.ts";

const TITLE = "Runs as a service";

/**
 * "Runs as a service": whether something starts the host at boot and after an update. A host
 * started by hand or with `run --background` gets a how-to rather than a fix: the unit and the
 * plist are written by install.sh, and the new service has to take over the port this very
 * process holds, so the host cannot do it from inside itself without stopping mid-answer (and a
 * host someone runs in a terminal is theirs to stop).
 */
export const serviceCheck = (
  look: ServiceLook,
  channel: ChannelConfig,
  host: string,
): SetupCheck => {
  switch (look.kind) {
    case "systemd":
      return ok(
        TITLE,
        `systemd user unit ${look.unit.replace(/\.service$/, "")}. Starts at boot, restarts after updates.`,
      );
    case "launchd":
      return ok(TITLE, `launchd agent ${look.label}. Starts at login, restarts after updates.`);
    case "app":
      return ok(
        `Runs with the ${channel.productName} app`,
        "It starts and stops with the app, and updates with it.",
      );
    case "source":
      return ok("Runs from source", "A source checkout: pull and rebuild to update it.");
    case "background":
    case "manual":
      return notAService(look, channel, host);
  }
};

const notAService = (
  look: Extract<ServiceLook, { kind: "background" | "manual" }>,
  channel: ChannelConfig,
  host: string,
): SetupCheck => ({
  id: "service",
  state: "warning",
  title: TITLE,
  detail:
    look.kind === "background"
      ? `Started with \`${channel.binaryName} run --background\`. It doesn't start again after a reboot.`
      : `Started by hand with \`${channel.binaryName} run\`. It stops when that terminal closes and doesn't start at boot.`,
  actions: [
    {
      kind: "how-to",
      steps: [
        `On ${host}, run this in a terminal. It installs ${channel.productName} again and registers the service that starts it at boot and restarts it after updates.`,
        "Projects, threads and settings stay as they are. Running turns carry on through the restart.",
      ],
      command: reinstallCommand(channel, look.binaryPath),
    },
  ],
});

/** install.sh for this channel, into the folder the running binary is in. */
export const reinstallCommand = (
  channel: ChannelConfig,
  binaryPath: string,
  home: string = homedir(),
): string => {
  const base = `curl -fsSL ${channel.feedOrigin}/install.sh | sh`;
  const installDir = dirname(binaryPath);
  // install.sh puts the binary in `<prefix>/bin`; anywhere else it picks its own default folder.
  if (basename(installDir) !== "bin" || defaultInstallDirs(channel, home).includes(installDir)) {
    return base;
  }
  return `${base} -s -- --prefix ${dirname(installDir)}`;
};

// Where install.sh puts the binary without --prefix (resolve_install_dir).
const defaultInstallDirs = (channel: ChannelConfig, home: string): string[] =>
  channel.id === "nightly"
    ? [join(home, channel.homeDirName, "bin")]
    : ["/usr/local/bin", join(home, ".local", "bin")];

const ok = (title: string, detail: string): SetupCheck => ({
  id: "service",
  state: "ok",
  title,
  detail,
  actions: [],
});
