import type { HostPlatform } from "./types";

interface PathEnvironment {
  home?: string;
  localAppData?: string;
  path?: string;
  userProfile?: string;
}

interface PlatformDetails {
  executableSuffix: string;
  pathSeparator: string;
  sidecarResourceName: string;
}

export const currentPlatform = (): HostPlatform =>
  process.platform === "win32" ? "windows" : "unix";

export const platformDetails = (platform: HostPlatform): PlatformDetails =>
  platform === "windows"
    ? { executableSuffix: ".exe", pathSeparator: ";", sidecarResourceName: "aop.exe" }
    : { executableSuffix: "", pathSeparator: ":", sidecarResourceName: "aop" };

export const guiSafePath = (): string =>
  guiSafePathFor(currentPlatform(), {
    home: process.env.HOME,
    localAppData: process.env.LOCALAPPDATA,
    path: process.env.PATH,
    userProfile: process.env.USERPROFILE,
  });

export const guiSafePathFor = (platform: HostPlatform, environment: PathEnvironment): string => {
  const paths = platform === "windows" ? windowsPaths(environment) : unixPaths(environment);
  const separator = platformDetails(platform).pathSeparator;
  if (environment.path) paths.push(...environment.path.split(separator));
  return [...new Set(paths.filter(Boolean))].join(separator);
};

const unixPaths = ({ home }: PathEnvironment): string[] => [
  ...(home ? [`${home}/.local/bin`, `${home}/.opencode/bin`, `${home}/.bun/bin`] : []),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

const windowsPaths = ({ localAppData, userProfile }: PathEnvironment): string[] => [
  ...(localAppData ? [`${localAppData}\\Microsoft\\WinGet\\Links`] : []),
  ...(userProfile
    ? [`${userProfile}\\.local\\bin`, `${userProfile}\\.bun\\bin`, `${userProfile}\\.opencode\\bin`]
    : []),
  "C:\\Program Files\\Git\\cmd",
  "C:\\Program Files\\GitHub CLI",
];
