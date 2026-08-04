export interface AopUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  canAutoUpdate: boolean;
  checkError?: string;
}

export interface AopUpdateInstallResult {
  status: "started";
  targetVersion: string;
  message: string;
}
