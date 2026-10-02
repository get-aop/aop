import { describe, expect, test } from "bun:test";
import { buildChannel, CHANNELS, channelDefine, parseReleaseChannel } from "./channel.ts";

describe("release channels", () => {
  test("a build made without a channel is stable, with the names stable always had", () => {
    expect(buildChannel()).toBe(CHANNELS.stable);
    expect(CHANNELS.stable).toMatchObject({
      homeDirName: ".aop",
      hostPort: 25150,
      binaryName: "aop",
      launchdLabel: "com.aop.local-server",
      systemdUnit: "aop-local-server",
      appId: "com.getaop.aop",
      productName: "AOP",
      feedOrigin: "https://getaop.com",
    });
  });

  test("nightly shares nothing that names an install with stable", () => {
    const keys = [
      "homeDirName",
      "hostPort",
      "dashboardPort",
      "binaryName",
      "launchdLabel",
      "systemdUnit",
      "appId",
      "productName",
      "feedOrigin",
    ] as const;
    for (const key of keys) expect(CHANNELS.nightly[key]).not.toBe(CHANNELS.stable[key]);
    expect(CHANNELS.nightly.feedOrigin).toBe("https://getaop.com/nightly");
  });

  test("only the exact name nightly picks nightly", () => {
    expect(parseReleaseChannel("nightly")).toBe("nightly");
    expect(parseReleaseChannel(" nightly\n")).toBe("nightly");
    expect(parseReleaseChannel("Nightly")).toBe("stable");
    expect(parseReleaseChannel(undefined)).toBe("stable");
    expect(channelDefine("nightly")).toEqual({ AOP_BUILD_CHANNEL: '"nightly"' });
  });

  test("a bundle built with the define reports that channel", async () => {
    const result = await Bun.build({
      entrypoints: [`${import.meta.dirname}/channel.ts`],
      define: channelDefine("nightly"),
      target: "bun",
    });
    expect(result.success).toBe(true);
    const source = await result.outputs[0]?.text();
    const url = `data:text/javascript;base64,${Buffer.from(source ?? "").toString("base64")}`;
    const built = (await import(url)) as typeof import("./channel.ts");
    expect(built.buildChannel().id).toBe("nightly");
  });
});
