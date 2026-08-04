import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { DEFAULT_LOCAL_SERVER_PORT, DEFAULT_LOCAL_SERVER_URL } from "./constants";
import { destroyTestContext, findFreePort, resolveE2EAgentProvider } from "./test-context";

let listenSpy: ReturnType<typeof spyOn> | undefined;
const originalRandom = Math.random;

afterEach(() => {
  listenSpy?.mockRestore();
  listenSpy = undefined;
  Math.random = originalRandom;
});

describe("E2E constants", () => {
  test("provide stable local defaults without requiring process env", () => {
    expect(DEFAULT_LOCAL_SERVER_PORT).toBe(25150);
    expect(DEFAULT_LOCAL_SERVER_URL).toBe("http://localhost:25150");
  });
});

describe("findFreePort", () => {
  test("finds a free port within the given range", async () => {
    listenSpy = spyOn(Bun, "listen").mockImplementation(((
      options: Parameters<typeof Bun.listen>[0],
    ) => {
      const port = "port" in options ? options.port : undefined;
      if (port === 30002) {
        return { stop: mock(() => undefined) } as unknown as ReturnType<typeof Bun.listen>;
      }

      throw createListenError("EADDRINUSE");
    }) as typeof Bun.listen);

    const port = await findFreePort(30000, 30099);
    expect(port).toBe(30002);
  });

  test("exhaustively scans the range even when random selection repeats occupied candidates", async () => {
    Math.random = () => 0;
    listenSpy = spyOn(Bun, "listen").mockImplementation(((
      options: Parameters<typeof Bun.listen>[0],
    ) => {
      const port = "port" in options ? options.port : undefined;
      if (port === 30124) {
        return { stop: mock(() => undefined) } as unknown as ReturnType<typeof Bun.listen>;
      }

      throw createListenError("EADDRINUSE");
    }) as typeof Bun.listen);

    await expect(findFreePort(30100, 30124)).resolves.toBe(30124);
  });

  test("throws when range is fully occupied", async () => {
    listenSpy = spyOn(Bun, "listen").mockImplementation(() => {
      throw createListenError("EADDRINUSE");
    });

    await expect(findFreePort(30200, 30200)).rejects.toThrow("No free port in range 30200-30200");
  });

  test("surfaces permission-denied probe failures as environment blockers", async () => {
    listenSpy = spyOn(Bun, "listen").mockImplementation(() => {
      throw createListenError("EPERM");
    });

    await expect(findFreePort(30300, 30399)).rejects.toThrow(
      "Port probing is blocked by the current environment for range 30300-30399 (received EPERM while probing localhost ports)",
    );
  });
});

describe("resolveE2EAgentProvider", () => {
  test("defaults to the deterministic fixture provider", () => {
    const original = process.env.AOP_E2E_AGENT_PROVIDER;
    try {
      delete process.env.AOP_E2E_AGENT_PROVIDER;
      expect(resolveE2EAgentProvider()).toBe("e2e-fixture");
    } finally {
      restoreProviderEnv(original);
    }
  });

  test("allows overriding the provider through the environment", () => {
    const original = process.env.AOP_E2E_AGENT_PROVIDER;
    try {
      process.env.AOP_E2E_AGENT_PROVIDER = "codex";
      expect(resolveE2EAgentProvider()).toBe("codex");
    } finally {
      restoreProviderEnv(original);
    }
  });

  test("ignores blank overrides", () => {
    const original = process.env.AOP_E2E_AGENT_PROVIDER;
    try {
      process.env.AOP_E2E_AGENT_PROVIDER = "   ";
      expect(resolveE2EAgentProvider()).toBe("e2e-fixture");
    } finally {
      restoreProviderEnv(original);
    }
  });
});

describe("destroyTestContext", () => {
  test("ignores missing setup state", async () => {
    await expect(destroyTestContext(undefined as unknown as never)).resolves.toBeUndefined();
    await expect(destroyTestContext({} as never)).resolves.toBeUndefined();
  });
});

const restoreProviderEnv = (value: string | undefined): void => {
  if (value === undefined) {
    delete process.env.AOP_E2E_AGENT_PROVIDER;
    return;
  }

  process.env.AOP_E2E_AGENT_PROVIDER = value;
};

const createListenError = (code: string): Error & { code: string } =>
  Object.assign(new Error(code), { code });
