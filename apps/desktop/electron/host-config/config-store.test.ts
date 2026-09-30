import { describe, expect, test } from "bun:test";
import {
  type ConfigStore,
  createConfigStore,
  DEFAULT_LOCAL_PORT,
  type DesktopConfig,
  defaultConfig,
  parseConfig,
} from "./config-store";
import { createMemoryFile } from "./test-utils";

const storeWith = (initial: DesktopConfig = defaultConfig()): ConfigStore =>
  createConfigStore(createMemoryFile(initial));

describe("config store", () => {
  test("starts with no host chosen and the default local port", async () => {
    expect(await storeWith().load()).toEqual({
      mode: null,
      remoteUrl: null,
      deviceName: null,
      localPort: DEFAULT_LOCAL_PORT,
      serveOverTailscale: false,
    });
  });

  test("merges an update over what is saved", async () => {
    const store = storeWith();

    await store.update({ mode: "remote", remoteUrl: "https://mac.tail1234.ts.net" });
    const after = await store.update({ deviceName: "Work laptop" });

    expect(after).toMatchObject({
      mode: "remote",
      remoteUrl: "https://mac.tail1234.ts.net",
      deviceName: "Work laptop",
    });
    expect(await store.load()).toEqual(after);
  });
});

describe("config store overrides", () => {
  test("wins over what is saved, and is never saved itself", async () => {
    const file = createMemoryFile<DesktopConfig>({ ...defaultConfig(), localPort: 25150 });
    const store = createConfigStore(file, { localPort: 25360 });

    expect((await store.load()).localPort).toBe(25360);
    const updated = await store.update({ mode: "local" });

    expect(updated).toMatchObject({ mode: "local", localPort: 25360 });
    expect(file.current().localPort).toBe(25150);
    expect(file.current().mode).toBe("local");
  });
});

describe("parseConfig", () => {
  test("keeps every valid field", () => {
    const saved: DesktopConfig = {
      mode: "local",
      remoteUrl: "https://mac.tail1234.ts.net",
      deviceName: "MacBook",
      localPort: 25360,
      serveOverTailscale: true,
    };

    expect(parseConfig(saved)).toEqual(saved);
  });

  test("falls back field by field, so one bad value does not lose the rest", () => {
    expect(
      parseConfig({
        mode: "cloud",
        remoteUrl: 7,
        deviceName: "",
        localPort: 70_000,
        serveOverTailscale: "yes",
      }),
    ).toEqual(defaultConfig());
    expect(parseConfig({ mode: "remote", localPort: 1.5 })).toMatchObject({
      mode: "remote",
      localPort: DEFAULT_LOCAL_PORT,
    });
  });

  test("reads anything that is not an object as the default", () => {
    for (const garbage of [null, 42, "text", []]) {
      expect(parseConfig(garbage)).toEqual(defaultConfig());
    }
  });
});
