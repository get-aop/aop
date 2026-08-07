import packageInfo from "../../package.json";

interface ElectronBuilderConfigOptions {
  version: string;
  notarize: boolean;
}

export const createElectronBuilderConfig = ({
  version,
  notarize,
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
    hardenedRuntime: true,
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
  notarize:
    process.env.AOP_MACOS_NOTARIZE === "1" ||
    process.env.AOP_MACOS_NOTARIZE?.toLowerCase() === "true",
});
