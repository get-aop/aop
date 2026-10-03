import type { SetupSystem } from "./system.ts";

/**
 * What computer use needs from a Linux host's system, and the ONE sudo command that installs
 * what is missing. AOP never runs it by itself: setup runs it only from an interactive terminal,
 * after asking; everywhere else it is printed (and shown in the dashboard's checklist).
 *
 * - The X server and window manager for the virtual display (only when setup makes one).
 * - The X libraries `cua-driver` links against, and the AT-SPI bus it reads windows through.
 * - A browser CUA Driver accepts: it launches only root-owned browsers at fixed paths, so the
 *   Ubuntu chromium snap does not count. Google Chrome's package is the one AOP installs.
 * - ffmpeg, which the live view captures the screen with (optional: computer use works without).
 */
export interface LinuxNeed {
  id: string;
  /** What the person reads in a checklist. */
  label: string;
  /** Not needed for threads to use CUA; only for an extra (the live view). */
  optional: boolean;
  /** Package names, by package manager. */
  packages: { apt: string[]; dnf: string[] };
}

export interface LinuxInspection {
  missing: LinuxNeed[];
  /** One command that installs every missing package; null when nothing is missing or there is no apt/dnf. */
  sudoCommand: string | null;
  /** The browser CUA Driver will launch, or null. */
  browser: string | null;
}

/** The browsers CUA Driver 0.32 launches on Linux, when root owns them. */
export const ACCEPTED_BROWSERS = [
  "/opt/google/chrome/google-chrome",
  "/usr/lib/chromium/chromium",
  "/usr/lib/chromium-browser/chromium-browser",
  "/opt/microsoft/msedge/msedge",
];

const LIBRARIES: Array<{ file: string; apt: string; dnf: string }> = [
  { file: "libX11.so.6", apt: "libx11-6", dnf: "libX11" },
  { file: "libXi.so.6", apt: "libxi6", dnf: "libXi" },
  { file: "libXext.so.6", apt: "libxext6", dnf: "libXext" },
  { file: "libxcb.so.1", apt: "libxcb1", dnf: "libxcb" },
  { file: "libxkbcommon.so.0", apt: "libxkbcommon0", dnf: "libxkbcommon" },
];

const AT_SPI_LAUNCHERS = [
  "/usr/libexec/at-spi-bus-launcher",
  "/usr/lib/at-spi2-core/at-spi-bus-launcher",
  "/usr/lib/at-spi-bus-launcher",
];

const CHROME_DEB = "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb";
const CHROME_RPM = "https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm";
// A package URL in the list stands for a download the command makes first.
const CHROME_PACKAGE = "google-chrome-stable";

export const inspectLinux = async (
  sys: SetupSystem,
  options: { virtualDisplay: boolean },
): Promise<LinuxInspection> => {
  const context: Context = { sys, libraries: await sharedLibraries(sys) };
  const missing = needsOf(options.virtualDisplay)
    .filter((item) => !item.present(context))
    .map(({ present: _, ...item }) => item);
  const browser = acceptedBrowser(sys);
  return { missing, sudoCommand: sudoCommandFor(sys, missing), browser };
};

/**
 * One line that installs everything missing with the host's package manager, Google Chrome from
 * Google's own package (which also adds Google's repository, so it stays updated).
 */
export const sudoCommandFor = (
  sys: SetupSystem,
  missing: LinuxNeed[],
  /** More steps that need root (letting the user's services run at boot). */
  extra: string[] = [],
): string | null => {
  if (missing.length === 0) return extra.length > 0 ? sudoLine(extra) : null;
  const manager = sys.which("apt-get") ? "apt" : sys.which("dnf") ? "dnf" : null;
  const wantsChrome = missing.some((item) => item.packages.apt.includes(CHROME_PACKAGE));
  if (!manager || (wantsChrome && sys.arch !== "x64")) return null;
  const packages = unique(
    missing.flatMap((item) => item.packages[manager]).filter((name) => name !== CHROME_PACKAGE),
  );
  const steps =
    manager === "apt" ? aptSteps(packages, wantsChrome) : dnfSteps(packages, wantsChrome);
  return sudoLine([...steps, ...extra]);
};

interface Context {
  sys: SetupSystem;
  libraries: Set<string> | null;
}

type Need = LinuxNeed & { present: (context: Context) => boolean };

const needsOf = (virtualDisplay: boolean): Need[] => [
  ...(virtualDisplay
    ? [
        command(
          "Xvfb",
          need("xvfb", "Xvfb (the virtual display)", ["xvfb"], ["xorg-x11-server-Xvfb"]),
        ),
        command("openbox", need("openbox", "openbox (a window manager)", ["openbox"], ["openbox"])),
      ]
    : []),
  ...LIBRARIES.map((library) => ({
    ...need(library.file, library.file, [library.apt], [library.dnf]),
    // A system whose linker cannot be asked is given the benefit of the doubt.
    present: ({ libraries }: Context) => libraries === null || libraries.has(library.file),
  })),
  {
    ...need("at-spi", "AT-SPI (the accessibility bus)", ["at-spi2-core"], ["at-spi2-core"]),
    present: ({ sys }) => AT_SPI_LAUNCHERS.some((path) => sys.exists(path)),
  },
  {
    ...need("browser", "Google Chrome (CUA Driver's browser)", [CHROME_PACKAGE], [CHROME_PACKAGE]),
    present: ({ sys }) => acceptedBrowser(sys) !== null,
  },
  {
    ...command("ffmpeg", need("ffmpeg", "ffmpeg (the live view)", ["ffmpeg"], ["ffmpeg"])),
    optional: true,
  },
];

const command = (name: string, item: LinuxNeed): Need => ({
  ...item,
  present: ({ sys }) => sys.which(name) !== null,
});

const acceptedBrowser = (sys: SetupSystem): string | null =>
  ACCEPTED_BROWSERS.find((path) => sys.exists(path) && sys.rootOwned(path)) ?? null;

// apt asks nothing (a fresh tzdata would otherwise stop the one command at a prompt).
const aptSteps = (packages: string[], chrome: boolean): string[] => [
  "export DEBIAN_FRONTEND=noninteractive",
  "apt-get update",
  ...(packages.length > 0
    ? [`apt-get install -y --no-install-recommends ${packages.join(" ")}`]
    : []),
  ...(chrome
    ? [
        `curl -fsSL -o /tmp/aop-google-chrome.deb ${CHROME_DEB}`,
        "apt-get install -y /tmp/aop-google-chrome.deb",
        "rm -f /tmp/aop-google-chrome.deb",
      ]
    : []),
];

const dnfSteps = (packages: string[], chrome: boolean): string[] => [
  ...(packages.length > 0 ? [`dnf install -y ${packages.join(" ")}`] : []),
  ...(chrome ? [`dnf install -y ${CHROME_RPM}`] : []),
];

const sudoLine = (steps: string[]): string => `sudo sh -c '${steps.join(" && ")}'`;

/** The shared libraries the dynamic linker knows, or null when it cannot say. */
const sharedLibraries = async (sys: SetupSystem): Promise<Set<string> | null> => {
  const ldconfig =
    sys.which("ldconfig") ?? (sys.exists("/sbin/ldconfig") ? "/sbin/ldconfig" : null);
  if (!ldconfig) return null;
  const result = await sys.run([ldconfig, "-p"]);
  if (result.exitCode !== 0) return null;
  const names = new Set<string>();
  for (const line of result.output.split("\n")) {
    const name = line.trim().split(/\s+/)[0];
    if (name?.includes(".so")) names.add(name);
  }
  return names;
};

const need = (id: string, label: string, apt: string[], dnf: string[]): LinuxNeed => ({
  id,
  label,
  optional: false,
  packages: { apt, dnf },
});

const unique = (items: string[]): string[] => [...new Set(items)];
