import {
  CHANNELS,
  desktopUpdaterFeedUrl,
  parseReleaseChannel,
  type ReleaseChannel,
} from "@aop/common";
import packageInfo from "../../package.json";

interface ElectronBuilderConfigOptions {
  version: string;
  notarize: boolean;
  /** True when a Developer ID identity is configured; false builds get an ad-hoc signature. */
  signed?: boolean;
  /**
   * `nightly` builds AOP Nightly (docs/NIGHTLY.md): its own app id and name (so its own data
   * folder, keychain item and single-instance lock), its own icon and its own update feed.
   */
  channel?: ReleaseChannel;
}

export const createElectronBuilderConfig = ({
  version,
  notarize,
  signed = true,
  channel = "stable",
}: ElectronBuilderConfigOptions) => ({
  appId: CHANNELS[channel].appId,
  productName: CHANNELS[channel].productName,
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
    // electron-builder names the folder electron-updater downloads into after the package name
    // (`@aopdesktop-updater` for stable). AOP Nightly gets its own, so the two apps never share a
    // pending download. Electron takes the app's name and data folder from productName, not this.
    ...(channel === "nightly" ? { name: "aop-nightly-desktop" } : {}),
    main: "dist-electron/main.cjs",
    version,
    description: "AOP desktop app for running local coding-agent workflows.",
  },
  // The feed the installed app updates from: getaop.com/latest/, where deploy-r2.sh puts
  // `latest.yml` and `latest-mac.yml`. This makes the Windows build write `latest.yml` and the
  // installer's blockmap beside the installer, and `app-update.yml` into the app's resources
  // (what electron-updater reads). The macOS `latest-mac.yml` that ships is written by
  // macos-updater.ts, because each architecture is a separate build. The workflow still passes
  // `--publish never`: nothing is uploaded from the build, the release job does that.
  publish: [
    {
      provider: "generic" as const,
      url: desktopUpdaterFeedUrl(CHANNELS[channel].feedOrigin),
    },
  ],
  // A nightly's version has a pre-release part (`-nightly.…`), from which electron-builder would
  // name the updater file `nightly-mac.yml`. Both channels publish `latest-mac.yml`, each under
  // its own feed (macos-updater.ts), so the app looks for that name.
  detectUpdateChannel: false,
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
    icon:
      channel === "nightly"
        ? "apps/desktop/build/nightly/icon.icns"
        : "apps/desktop/build/icon.icns",
    notarize,
    // The DMG is what people install; the zip is what an installed, signed app updates from.
    target: [
      { target: "dmg", arch: ["x64", "arm64"] },
      { target: "zip", arch: ["x64", "arm64"] },
    ],
  },
  dmg: {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Electron Builder expands artifact placeholders.
    title: `${CHANNELS[channel].productName} ${"${version} ${arch}"}`,
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
    shortcutName: CHANNELS[channel].productName,
  },
});

// macos-dmg.ts passes a nightly's version (`0.10.7-nightly.<date>.<run>`) in AOP_APP_VERSION.
export default createElectronBuilderConfig({
  version: process.env.AOP_APP_VERSION?.trim() || packageInfo.version,
  channel: parseReleaseChannel(process.env.AOP_BUILD_CHANNEL),
  signed: Boolean(process.env.AOP_MACOS_SIGN_IDENTITY?.trim()),
  notarize:
    process.env.AOP_MACOS_NOTARIZE === "1" ||
    process.env.AOP_MACOS_NOTARIZE?.toLowerCase() === "true",
});
