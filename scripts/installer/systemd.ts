/** The systemd user unit install.sh registers for the AOP local server. */
export const SYSTEMD_USER_SERVICE_NAME = "aop-local-server.service";

export type SpawnSyncFn = (command: string[]) => { exitCode: number | null };

export const isSystemdUserServiceActive = (spawnSync: SpawnSyncFn): boolean =>
  spawnSync(["systemctl", "--user", "is-active", SYSTEMD_USER_SERVICE_NAME]).exitCode === 0;

export const stopSystemdUserService = (spawnSync: SpawnSyncFn): boolean =>
  spawnSync(["systemctl", "--user", "stop", SYSTEMD_USER_SERVICE_NAME]).exitCode === 0;
