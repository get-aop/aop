export const IPC_CHANNELS = {
  getSetupState: "desktop:get-setup-state",
  runSetupAction: "desktop:run-setup-action",
  openSetupGuide: "desktop:open-setup-guide",
  startAopSidecar: "desktop:start-aop-sidecar",
  getSidecarState: "desktop:get-sidecar-state",
  openLogsFolder: "desktop:open-logs-folder",
  quitApp: "desktop:quit-app",
  listWslDistros: "desktop:list-wsl-distros",
  getExecHost: "desktop:get-exec-host",
  setExecHost: "desktop:set-exec-host",
  setZoom: "desktop:set-zoom",
} as const;
