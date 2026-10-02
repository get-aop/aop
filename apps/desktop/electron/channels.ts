export const IPC_CHANNELS = {
  // The connect screen only: what it asks the app to do.
  getState: "desktop:get-state",
  connectHost: "desktop:connect-host",
  forgetHost: "desktop:forget-host",
  startHostMode: "desktop:start-host-mode",
  stopHostMode: "desktop:stop-host-mode",
  setServeOverTailscale: "desktop:set-serve-over-tailscale",
  createPairingCode: "desktop:create-pairing-code",
  openDashboard: "desktop:open-dashboard",
  reconnect: "desktop:reconnect",
  openLogsFolder: "desktop:open-logs-folder",
  quitApp: "desktop:quit-app",
  // The bundled dashboard only: which host to talk to, and that the host refused the token.
  getHostConfig: "desktop:get-host-config",
  hostRejected: "desktop:host-rejected",
  // Either page.
  setZoom: "desktop:set-zoom",
  getUpdateState: "desktop:get-update-state",
  openUpdateDownload: "desktop:open-update-download",
  restartToUpdate: "desktop:restart-to-update",
  // The bundled dashboard's AOP Browser: whether it is shown, and the person's answers.
  browserSetActive: "desktop:browser-set-active",
  browserAnswerPrompt: "desktop:browser-answer-prompt",
  browserDownloadAction: "desktop:browser-download-action",
  // The app to the dashboard: what its browser's pages did that only the app sees.
  browserEvent: "desktop:browser-event",
  // The app to the connect screen: something it shows changed.
  stateChanged: "desktop:state-changed",
  updateStateChanged: "desktop:update-state-changed",
} as const;
