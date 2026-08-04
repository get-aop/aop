import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface JiraTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  cloudId: string;
  siteUrl: string;
  siteName: string;
}

interface ExecResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

interface ExecInvocation {
  args: string[];
  env?: Record<string, string | undefined>;
  stdin?: string;
}

interface JiraTokenStore {
  save(tokens: JiraTokenSet): Promise<void>;
  getStatus(): Promise<{ connected: boolean; locked: boolean }>;
  unlock(): Promise<void>;
  read(): Promise<JiraTokenSet>;
  lock(): Promise<void> | void;
  disconnect(): Promise<void>;
}

interface JiraTokenStoreModule {
  createJiraTokenStore(options?: {
    accountName?: string;
    exec?: (invocation: ExecInvocation) => Promise<ExecResult>;
    env?: NodeJS.ProcessEnv;
    fallbackFilePath?: string;
    kernelRelease?: string;
    platform?: NodeJS.Platform;
    serviceName?: string;
  }): JiraTokenStore;
}

const TOKENS: JiraTokenSet = {
  accessToken: "jira-access-secret",
  refreshToken: "jira-refresh-secret",
  expiresAt: "2026-03-12T12:00:00.000Z",
  cloudId: "cloud-123",
  siteUrl: "https://acme.atlassian.net",
  siteName: "Acme",
};

const loadTokenStoreModule = async (): Promise<JiraTokenStoreModule> =>
  (await import("./oauth-token-store.ts")) as JiraTokenStoreModule;

describe("integrations/jira/oauth-token-store", () => {
  let invocations: ExecInvocation[];
  let responses: ExecResult[];
  let tempDirs: string[];

  beforeEach(() => {
    invocations = [];
    responses = [];
    tempDirs = [];
  });

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  const createFallbackFilePath = async (): Promise<string> => {
    const tempDir = await mkdtemp(join(tmpdir(), "aop-jira-token-store-"));
    tempDirs.push(tempDir);
    return join(tempDir, "jira-oauth.json");
  };

  const exec = async (invocation: ExecInvocation): Promise<ExecResult> => {
    invocations.push(invocation);
    const next = responses.shift();
    if (!next) {
      throw new Error("unexpected exec invocation");
    }
    return next;
  };

  test("stores tokens in macOS Keychain without passing the secret via argv", async () => {
    const { createJiraTokenStore } = await loadTokenStoreModule();
    const store = createJiraTokenStore({
      exec,
      fallbackFilePath: await createFallbackFilePath(),
      platform: "darwin",
    });
    responses.push({ exitCode: 0 });

    await store.save(TOKENS);

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.args).toEqual([
      "sh",
      "-lc",
      "security add-generic-password -U -s 'aop.jira.oauth' -a 'default' -w \"$AOP_JIRA_TOKENS\"",
    ]);
    expect(invocations[0]?.env?.AOP_JIRA_TOKENS).toBe(JSON.stringify(TOKENS));
    expect(invocations[0]?.args.join(" ")).not.toContain("jira-access-secret");
  });

  test("stores tokens in Linux Secret Service via stdin", async () => {
    const { createJiraTokenStore } = await loadTokenStoreModule();
    const store = createJiraTokenStore({
      exec,
      fallbackFilePath: await createFallbackFilePath(),
      platform: "linux",
    });
    responses.push({ exitCode: 0 });

    await store.save(TOKENS);

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.args).toEqual([
      "secret-tool",
      "store",
      "--label",
      "AOP Jira OAuth",
      "service",
      "aop.jira.oauth",
      "account",
      "default",
    ]);
    expect(invocations[0]?.stdin).toBe(JSON.stringify(TOKENS));
  });

  test("stores tokens in a file on Windows without invoking secure storage", async () => {
    const { createJiraTokenStore } = await loadTokenStoreModule();
    const store = createJiraTokenStore({
      exec, // must never be called on win32
      fallbackFilePath: await createFallbackFilePath(),
      platform: "win32",
    });

    await store.save(TOKENS);
    expect(invocations).toHaveLength(0);
    expect(await store.getStatus()).toEqual({ connected: true, locked: false });
    expect(await store.read()).toEqual(TOKENS);

    await store.disconnect();
    expect(invocations).toHaveLength(0);
    expect(await store.getStatus()).toEqual({ connected: false, locked: true });
  });

  test("starts locked when macOS credentials exist and unlock loads them into memory", async () => {
    const { createJiraTokenStore } = await loadTokenStoreModule();
    const store = createJiraTokenStore({
      exec,
      fallbackFilePath: await createFallbackFilePath(),
      platform: "darwin",
    });
    responses.push({ exitCode: 0, stdout: JSON.stringify(TOKENS) });
    responses.push({ exitCode: 0, stdout: JSON.stringify(TOKENS) });

    expect(await store.getStatus()).toEqual({ connected: true, locked: true });
    await expect(store.read()).rejects.toThrow("Jira token store is locked");

    await store.unlock();
    expect(await store.read()).toEqual(TOKENS);
  });

  test("locks again after reading and deletes Linux credentials on disconnect", async () => {
    const { createJiraTokenStore } = await loadTokenStoreModule();
    const store = createJiraTokenStore({
      exec,
      fallbackFilePath: await createFallbackFilePath(),
      platform: "linux",
    });
    responses.push({ exitCode: 0, stdout: JSON.stringify(TOKENS) });
    responses.push({ exitCode: 0 });
    responses.push({ exitCode: 1, stderr: "not found" });

    await store.unlock();
    expect((await store.read()).accessToken).toBe("jira-access-secret");

    await store.lock();
    await expect(store.read()).rejects.toThrow("Jira token store is locked");

    await store.disconnect();
    expect(await store.getStatus()).toEqual({
      connected: false,
      locked: true,
    });
  });

  test("rejects token sets missing the resolved Jira site", async () => {
    const { createJiraTokenStore } = await loadTokenStoreModule();
    const store = createJiraTokenStore({
      exec,
      fallbackFilePath: await createFallbackFilePath(),
      platform: "darwin",
    });
    responses.push({
      exitCode: 0,
      stdout: JSON.stringify({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: "2026-03-12T12:00:00.000Z",
      }),
    });

    await expect(store.unlock()).rejects.toThrow("Jira OAuth credentials are invalid");
  });

  test("getStatus fails closed to disconnected when secure storage is unavailable", async () => {
    const { createJiraTokenStore } = await loadTokenStoreModule();
    const store = createJiraTokenStore({
      exec,
      fallbackFilePath: await createFallbackFilePath(),
      platform: "linux",
    });
    responses.push({ exitCode: 127, stderr: "secret-tool: command not found" });

    expect(await store.getStatus()).toEqual({
      connected: false,
      locked: true,
    });
  });

  test("falls back to a local file on WSL when secret-tool is unavailable", async () => {
    const { createJiraTokenStore } = await loadTokenStoreModule();
    const tempDir = await mkdtemp(join(tmpdir(), "aop-jira-token-store-"));
    tempDirs.push(tempDir);
    const fallbackFilePath = join(tempDir, "jira-oauth.json");
    const store = createJiraTokenStore({
      exec: async (invocation) => {
        invocations.push(invocation);
        throw new Error('Executable not found in $PATH: "secret-tool"');
      },
      env: {
        WSL_DISTRO_NAME: "Ubuntu",
      } as NodeJS.ProcessEnv,
      fallbackFilePath,
      kernelRelease: "6.6.87.2-microsoft-standard-WSL2",
      platform: "linux",
    });

    await store.save(TOKENS);

    expect(await readFile(fallbackFilePath, "utf8")).toBe(JSON.stringify(TOKENS));
    expect(await store.getStatus()).toEqual({
      connected: true,
      locked: false,
    });
    expect(await store.read()).toEqual(TOKENS);

    await store.disconnect();
    expect(await store.getStatus()).toEqual({
      connected: false,
      locked: true,
    });
  });
});
