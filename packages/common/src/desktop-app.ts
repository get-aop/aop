import { z } from "zod";

/**
 * The desktop app's own update ("This app" in the Updates popover and on AOP settings › Updates).
 * `off`: this build does not update itself (Linux, a development run). `available` with
 * `mode: "notice"`: an unsigned Mac build, which cannot replace itself; the person downloads the
 * new app and replaces it. `available` with `mode: "auto"` appears only while automatic download
 * is off: "Download and restart" fetches it. `error` keeps the version it was after, if any.
 */
export const AppUpdateStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("off") }),
  z.object({ status: z.literal("idle"), checkedAt: z.string().nullable() }),
  z.object({ status: z.literal("checking") }),
  z.object({
    status: z.literal("available"),
    version: z.string(),
    releaseUrl: z.string().nullable(),
    mode: z.enum(["auto", "notice"]),
  }),
  z.object({ status: z.literal("downloading"), version: z.string(), percent: z.number() }),
  z.object({ status: z.literal("ready"), version: z.string(), releaseUrl: z.string().nullable() }),
  z.object({ status: z.literal("error"), message: z.string(), version: z.string().nullable() }),
]);
export type AppUpdateState = z.infer<typeof AppUpdateStateSchema>;

/** The desktop app itself, as the dashboard inside it shows it. */
export const DesktopAppInfoSchema = z.object({
  /** "AOP" or "AOP Nightly". */
  name: z.string(),
  version: z.string(),
  /** `process.platform` of the app: darwin, win32, linux. */
  platform: z.string(),
  /** The app downloads a new build by itself (desktop-config `autoDownloadUpdates`). */
  autoDownload: z.boolean(),
});
export type DesktopAppInfo = z.infer<typeof DesktopAppInfoSchema>;

/**
 * What the dashboard calls on `window.aopDesktop` for "This app". Every method is one IPC round
 * trip; the dashboard treats each as optional, since a browser has no bridge at all.
 */
export interface DesktopAppUpdateBridge {
  getAppInfo: () => Promise<DesktopAppInfo>;
  getUpdateState: () => Promise<AppUpdateState>;
  onUpdateStateChanged: (listener: (state: AppUpdateState) => void) => () => void;
  /** Looks for a new build now; resolves with the state it ends in. */
  checkForUpdates: () => Promise<AppUpdateState>;
  /** With automatic download off: downloads the new build, then restarts onto it. */
  downloadAndRestart: () => Promise<void>;
  /** Installs a downloaded build and reopens the app. */
  restartToUpdate: () => Promise<void>;
  /** An unsigned Mac build: opens the new version's download page. */
  openUpdateDownload: () => Promise<void>;
  setAutoDownload: (enabled: boolean) => Promise<void>;
  /** The app menu's "Check for Updates…": the dashboard opens the Updates popover. */
  onOpenUpdates: (listener: () => void) => () => void;
  /** The Host menu's "Host Setup…": the dashboard opens AOP settings › Host. */
  onOpenHostSetup: (listener: () => void) => () => void;
}

/**
 * The header a client sends so the host can show, per paired device, which app and version it
 * runs (AOP settings › Host). Value: `desktop; version=0.10.8; platform=darwin`. A browser sends
 * none; the host then reads its User-Agent.
 */
export const CLIENT_HEADER = "x-aop-client";

export const ClientInfoSchema = z.object({
  app: z.enum(["desktop", "browser"]),
  version: z.string().nullable(),
  /** darwin, win32, linux, android, ios; null when unknown. */
  platform: z.string().nullable(),
});
export type ClientInfo = z.infer<typeof ClientInfoSchema>;

export const formatClientHeader = (info: Omit<ClientInfo, "app">): string =>
  [
    "desktop",
    info.version && `version=${info.version}`,
    info.platform && `platform=${info.platform}`,
  ]
    .filter(Boolean)
    .join("; ");

/** Reads a `CLIENT_HEADER` value; null when it is not one. */
export const parseClientHeader = (value: string | null | undefined): ClientInfo | null => {
  const [app, ...fields] = (value ?? "").split(";").map((part) => part.trim());
  if (app !== "desktop") return null;
  const field = (name: string) =>
    fields.find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || null;
  return { app, version: field("version"), platform: field("platform") };
};

/** Reads a browser's User-Agent into the platform it runs on; null when it says nothing known. */
export const browserPlatformOf = (userAgent: string | null | undefined): string | null => {
  const ua = userAgent ?? "";
  if (/iPhone|iPad/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Mac OS X|Macintosh/.test(ua)) return "darwin";
  if (/Windows/.test(ua)) return "win32";
  if (/Linux/.test(ua)) return "linux";
  return null;
};
