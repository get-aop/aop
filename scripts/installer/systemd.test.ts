import { describe, expect, test } from "bun:test";
import {
  isSystemdUserServiceActive,
  SYSTEMD_USER_SERVICE_NAME,
  stopSystemdUserService,
} from "./systemd.ts";

type SpawnSyncStub = (command: string[]) => { exitCode: number | null };

const spawnSyncStub =
  (exitCodes: Record<string, number>): SpawnSyncStub =>
  (command) => ({
    exitCode: exitCodes[command.join(" ")] ?? 1,
  });

describe("systemd service control", () => {
  test("isSystemdUserServiceActive is true only when systemctl reports the unit active", () => {
    const spawnSync = spawnSyncStub({
      [`systemctl --user is-active ${SYSTEMD_USER_SERVICE_NAME}`]: 0,
    });

    expect(isSystemdUserServiceActive(spawnSync)).toBe(true);
    expect(isSystemdUserServiceActive(spawnSyncStub({}))).toBe(false);
  });

  test("stopSystemdUserService stops the unit and reports success", () => {
    const spawnSync = spawnSyncStub({
      [`systemctl --user stop ${SYSTEMD_USER_SERVICE_NAME}`]: 0,
    });

    expect(stopSystemdUserService(spawnSync)).toBe(true);
    expect(stopSystemdUserService(spawnSyncStub({}))).toBe(false);
  });
});
