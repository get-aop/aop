import { describe, expect, mock, test } from "bun:test";
import type { AppUpdateState } from "@aop/common";
import { createAppUpdateHost } from "./app-update-host";
import type { AppUpdater } from "./app-updater";

const setup = (state: AppUpdateState, downloadUrl: string | null = null) => {
  const updater = {
    state: () => state,
    start: () => {},
    stop: () => {},
    check: mock(async () => state),
    downloadUrl: () => downloadUrl,
    restartToUpdate: mock(() => {}),
    downloadAndRestart: mock(async () => {}),
    setAutoDownload: mock((_enabled: boolean) => {}),
  } satisfies AppUpdater;
  const saveAutoDownload = mock(async (_enabled: boolean) => {});
  const openExternal = mock(async (_url: string) => {});
  const host = createAppUpdateHost({
    updater,
    info: { name: "AOP Nightly", version: "0.10.8-nightly.20261003.4", platform: "darwin" },
    autoDownload: true,
    saveAutoDownload,
    openExternal,
    isSafeDownloadUrl: (url) => url.startsWith("https://getaop.com/"),
  });
  return { host, updater, saveAutoDownload, openExternal };
};

describe("createAppUpdateHost", () => {
  test("tells the page which app this is, and whether it downloads by itself", () => {
    const { host } = setup({ status: "off" });

    expect(host.getAppInfo()).toEqual({
      name: "AOP Nightly",
      version: "0.10.8-nightly.20261003.4",
      platform: "darwin",
      autoDownload: true,
    });
    expect(host.getUpdateState()).toEqual({ status: "off" });
  });

  test("saves automatic download, then hands it to the updater and the next getAppInfo", async () => {
    const { host, updater, saveAutoDownload } = setup({ status: "idle", checkedAt: null });

    await host.setAutoDownload(false);

    expect(saveAutoDownload).toHaveBeenCalledWith(false);
    expect(updater.setAutoDownload).toHaveBeenCalledWith(false);
    expect(host.getAppInfo().autoDownload).toBe(false);
  });

  test("a setting that cannot be saved is not applied", async () => {
    const { host, updater, saveAutoDownload } = setup({ status: "idle", checkedAt: null });
    saveAutoDownload.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });

    await expect(host.setAutoDownload(false)).rejects.toThrow("disk full");
    expect(updater.setAutoDownload).not.toHaveBeenCalled();
    expect(host.getAppInfo().autoDownload).toBe(true);
  });

  test("passes the actions through to the updater", async () => {
    const { host, updater } = setup({ status: "ready", version: "1", releaseUrl: null });

    await host.checkForUpdates();
    await host.downloadAndRestart();
    await host.restartToUpdate();

    expect(updater.check).toHaveBeenCalledTimes(1);
    expect(updater.downloadAndRestart).toHaveBeenCalledTimes(1);
    expect(updater.restartToUpdate).toHaveBeenCalledTimes(1);
  });

  test("opens the feed's download page, and nothing else", async () => {
    const notice = { status: "available", version: "1", releaseUrl: null, mode: "notice" } as const;
    const safe = setup(notice, "https://getaop.com/v1/aop-macos-arm64.dmg");
    const unsafe = setup(notice, "https://evil.test/aop.dmg");

    await safe.host.openUpdateDownload();
    await unsafe.host.openUpdateDownload();

    expect(safe.openExternal).toHaveBeenCalledWith("https://getaop.com/v1/aop-macos-arm64.dmg");
    expect(unsafe.openExternal).not.toHaveBeenCalled();
  });
});
