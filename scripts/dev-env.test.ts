import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { applyDevAopHome, DEV_AOP_HOME_DIR, parseEnvFile, resolveDevAopHome } from "./dev-env.ts";

describe("resolveDevAopHome", () => {
  it("resolves the dev home under the given home directory", () => {
    expect(resolveDevAopHome("/home/dev")).toBe(join("/home/dev", DEV_AOP_HOME_DIR));
  });

  it("keeps the dev home separate from the release home", () => {
    expect(resolveDevAopHome("/home/dev")).not.toBe(join("/home/dev", ".aop"));
  });
});

describe("applyDevAopHome", () => {
  it("sets AOP_HOME to the dev home when unset", () => {
    const env: Record<string, string | undefined> = {};

    const result = applyDevAopHome(env, "/home/dev");

    expect(result).toBe(join("/home/dev", DEV_AOP_HOME_DIR));
    expect(env.AOP_HOME).toBe(join("/home/dev", DEV_AOP_HOME_DIR));
  });

  it("keeps an explicit AOP_HOME", () => {
    const env: Record<string, string | undefined> = { AOP_HOME: "/custom/home" };

    const result = applyDevAopHome(env, "/home/dev");

    expect(result).toBe("/custom/home");
    expect(env.AOP_HOME).toBe("/custom/home");
  });

  it("treats a blank AOP_HOME as unset", () => {
    const env: Record<string, string | undefined> = { AOP_HOME: "   " };

    const result = applyDevAopHome(env, "/home/dev");

    expect(result).toBe(join("/home/dev", DEV_AOP_HOME_DIR));
    expect(env.AOP_HOME).toBe(join("/home/dev", DEV_AOP_HOME_DIR));
  });
});

describe("parseEnvFile", () => {
  it("parses assignments and ignores comments and blanks", () => {
    const parsed = parseEnvFile("# comment\n\nAOP_HOME=/a/b\nAOP_DASHBOARD_PORT=25160\n");

    expect(parsed.get("AOP_HOME")).toBe("/a/b");
    expect(parsed.get("AOP_DASHBOARD_PORT")).toBe("25160");
    expect(parsed.size).toBe(2);
  });

  it("keeps values containing equals signs intact", () => {
    const parsed = parseEnvFile("AOP_LOCAL_SERVER_URL=http://localhost:25150/?a=b\n");

    expect(parsed.get("AOP_LOCAL_SERVER_URL")).toBe("http://localhost:25150/?a=b");
  });
});
