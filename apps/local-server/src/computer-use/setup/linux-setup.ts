import type { ComputerUseConfig } from "../config.ts";
import { parseComputerUseConfig } from "../config.ts";
import {
  DEFAULT_VIRTUAL_DISPLAY,
  type DesktopSession,
  detectDesktop,
  enableLinger,
  ensureVirtualDisplay,
  lingerEnabled,
} from "./display.ts";
import { inspectLinux, sudoCommandFor } from "./linux-packages.ts";
import type { SetupIO, SetupOptions } from "./run-setup.ts";
import type { SetupSystem } from "./system.ts";

type Screen = Required<ComputerUseConfig>;

/** The Linux part of setup: the screen, the packages that need root, and the choice kept. */
export const setupLinux = async (
  sys: SetupSystem,
  io: SetupIO,
  options: SetupOptions,
  configPath: string,
): Promise<void> => {
  const current = parseComputerUseConfig(sys.readText(configPath));
  const chosen = await chooseScreen(sys, io, options, current);
  const virtual = chosen.screen === "virtual";
  await ensurePackages(sys, io, options, virtual);
  if (virtual) await reportVirtualDisplay(sys, io, chosen.display);
  else io.print(`✓ Threads will use your desktop's display ${chosen.display}.`);
  if (current.display !== chosen.display || current.screen !== chosen.screen) {
    sys.writeText(configPath, `${JSON.stringify({ ...current, ...chosen }, null, 2)}\n`);
  }
};

/**
 * The screen threads drive: what the flags say, else what an earlier setup chose, else a virtual
 * display, unless someone at the terminal says to use the desktop session that is up.
 */
const chooseScreen = async (
  sys: SetupSystem,
  io: SetupIO,
  options: SetupOptions,
  current: ComputerUseConfig,
): Promise<Screen> => {
  const virtual: Screen = { screen: "virtual", display: virtualDisplayOf(options, current) };
  const desktop = detectDesktop(sys, virtual.display);
  const wanted = options.screen ?? current.screen;
  if (wanted === "desktop") {
    const display = options.display ?? current.display ?? desktop?.display ?? sys.env.DISPLAY;
    if (display) return { screen: "desktop", display };
    io.print("No desktop display was found; using a virtual display instead.");
    return virtual;
  }
  if (wanted === undefined && desktop?.display && io.interactive) {
    return (await askForDesktop(io, desktop))
      ? { screen: "desktop", display: desktop.display }
      : virtual;
  }
  return virtual;
};

const virtualDisplayOf = (options: SetupOptions, current: ComputerUseConfig): string => {
  if (options.screen !== "desktop" && options.display) return options.display;
  if (current.screen === "virtual" && current.display) return current.display;
  return DEFAULT_VIRTUAL_DISPLAY;
};

const askForDesktop = async (io: SetupIO, desktop: DesktopSession): Promise<boolean> => {
  const kind = desktop.kind === "wayland" ? "Wayland, X display" : "X display";
  io.print(`A desktop session is running here (${kind} ${desktop.display}).`);
  io.print(
    "Threads can drive a virtual display of their own (recommended: they never move your mouse or windows), or your desktop.",
  );
  return io.confirm(`Use your desktop (${desktop.display}) instead of a virtual display?`, false);
};

/** Shows the one sudo command for what is missing; runs it only when someone at the terminal says so. */
const ensurePackages = async (
  sys: SetupSystem,
  io: SetupIO,
  options: SetupOptions,
  virtual: boolean,
): Promise<void> => {
  const linger = virtual ? await lingerStep(sys) : [];
  const packages = await inspectLinux(sys, { virtualDisplay: virtual });
  const sudo = sudoCommandFor(sys, packages.missing, linger);
  const labels = packages.missing.map((item) => item.label);
  if (!sudo) {
    io.print(
      labels.length > 0
        ? `Install these with your package manager: ${labels.join(", ")}.`
        : "✓ System packages",
    );
    return;
  }
  const reasons = [
    ...labels,
    ...(linger.length > 0 ? ["starting your services at boot (linger)"] : []),
  ];
  io.print(`Computer use needs root for: ${reasons.join(", ")}.`);
  io.print(`  ${sudo}`);
  const run =
    io.interactive && !options.noSudo && (await io.confirm("Run it now with sudo?", true));
  if (!run) {
    io.print("Run that once as root (it asks for your password), then run setup again.");
    return;
  }
  const result = await sys.run(["/bin/sh", "-c", sudo], { interactive: true });
  io.print(
    result.exitCode === 0
      ? "✓ System packages installed."
      : "✗ The sudo command failed; run it again by hand.",
  );
};

// Linger lets the virtual display start at boot; a user can usually turn it on for themselves.
const lingerStep = async (sys: SetupSystem): Promise<string[]> =>
  (await lingerEnabled(sys)) === false && !(await enableLinger(sys))
    ? [`loginctl enable-linger ${sys.user}`]
    : [];

const reportVirtualDisplay = async (sys: SetupSystem, io: SetupIO, display: string) => {
  const result = await ensureVirtualDisplay(sys, display);
  if (!result.started) {
    io.print(`✗ Virtual display ${display}: ${result.problem}`);
    return;
  }
  const written = result.written.length > 0 ? ", written now" : "";
  io.print(`✓ Virtual display ${display} (aop-xvfb + aop-openbox user services${written})`);
};
