import { desktopUpdaterFeedUrl } from "@aop/common";
import packageInfo from "../../package.json";

interface ElectronBuilderConfigOptions {
  version: string;
  notarize: boolean;
  /** True when a Developer ID identity is configured; false builds get an ad-hoc signature. */
  signed?: boolean;
}

export const createElectronBuilderConfig = ({
  version,
  notarize,
  signed = true,
}: ElectronBuilderConfigOptions) => ({
  appId: "com.getaop.aop",
  productName: "AOP",
  electronVersion: "43.3.0",
  asar: true,
  compression: "normal" as const,
  npmRebuild: false,
  directories: {
    app: "apps/desktop",
    buildResources: "apps/desktop/build",
    output: "dist/electron-builder",
  },
  extraMetadata: {
    main: "dist-electron/main.cjs",
    version,
    description: "AOP desktop app for running local coding-agent workflows.",
  },
  // The feed the installed app updates from: getaop.com/latest/, where deploy-r2.sh puts
  // `latest.yml` (the repository is private, so its GitHub Releases cannot be read). This makes
  // the Windows build write `latest.yml` and the installer's blockmap beside the installer, and
  // `app-update.yml` into the app's resources (what electron-updater reads). The workflow still
  // passes `--publish never`: nothing is uploaded from the build, the release job does that.
  publish: [{ provider: "generic" as const, url: desktopUpdaterFeedUrl() }],
  files: ["dist/**/*", "dist-electron/**/*", "package.json"],
  extraResources: [
    {
      from: "apps/desktop/resources",
      to: ".",
      filter: ["**/*"],
    },
  ],
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  },
  mac: {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Electron Builder expands artifact placeholders.
    artifactName: "aop-macos-${arch}.${ext}",
    category: "public.app-category.developer-tools",
    darkModeSupport: true,
    // An unsigned build still has to carry a valid signature: flipping the Electron fuses breaks the
    // one the framework ships with, and Apple silicon kills a process whose signature is invalid
    // ("Killed: 9" at launch). An ad-hoc signature ("-") keeps it launchable; Gatekeeper still
    // warns about an unidentified developer, which is the documented first-run step. Hardened
    // runtime is off for ad-hoc builds because its library validation rejects the
    // differently-signed Electron frameworks.
    identity: signed ? undefined : "-",
    hardenedRuntime: signed,
    icon: "apps/desktop/build/icon.icns",
    notarize,
    target: [{ target: "dmg", arch: ["x64", "arm64"] }],
  },
  dmg: {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Electron Builder expands artifact placeholders.
    title: "AOP ${version} ${arch}",
    contents: [
      { x: 140, y: 220, type: "file" as const },
      { x: 400, y: 220, type: "link" as const, path: "/Applications" },
    ],
  },
  win: {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Electron Builder expands artifact placeholders.
    artifactName: "aop-windows-${arch}-setup.${ext}",
    icon: "apps/desktop/build/icon.ico",
    target: [{ target: "nsis", arch: ["x64"] }],
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    shortcutName: "AOP",
  },
});

export default createElectronBuilderConfig({
  version: packageInfo.version,
  signed: Boolean(process.env.AOP_MACOS_SIGN_IDENTITY?.trim()),
  notarize:
    process.env.AOP_MACOS_NOTARIZE === "1" ||
    process.env.AOP_MACOS_NOTARIZE?.toLowerCase() === "true",
});
