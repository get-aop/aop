import { describe, expect, test } from "bun:test";
import type { HostSetup } from "@aop/common";
import type { fetchServer } from "./client.ts";
import { type PairDeps, pairCommand } from "./pair.ts";

const NOW = new Date("2026-10-03T09:00:00.000Z");
const GRANT = { code: "K7QM-4XNP", expiresAt: "2026-10-03T09:10:00.000Z" };

const setup = (overrides: Partial<HostSetup> = {}): HostSetup => ({
  hostName: "soulf",
  os: "linux",
  channel: "nightly",
  version: "0.10.8-nightly.20261003.4",
  uptimeSeconds: 60,
  addresses: ["https://soulf.tailffbdec.ts.net:25650"],
  checks: [],
  ready: 6,
  total: 6,
  ...overrides,
});

type Answer = Awaited<ReturnType<typeof fetchServer>> | Error;

/** A host that answers each path as given; a path it does not know is a 404. */
const run = async (answers: Record<string, Answer>) => {
  const lines: string[] = [];
  const asked: string[] = [];
  const request = (async (path: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${path}`);
    const answer = answers[path] ?? { ok: false, status: 404, error: { error: "Not Found" } };
    if (answer instanceof Error) throw answer;
    return answer;
  }) as PairDeps["request"];
  const exitCode = await pairCommand({
    request,
    print: (line) => lines.push(line),
    now: () => NOW,
    serverUrl: "http://127.0.0.1:25650",
    binaryName: "aop-nightly",
  });
  return { exitCode, lines, asked };
};

describe("pairCommand", () => {
  test("prints the code, when it expires and where to enter it", async () => {
    const { exitCode, lines, asked } = await run({
      "/api/auth/pairing-codes": { ok: true, data: GRANT },
      "/api/host/setup": { ok: true, data: setup() },
    });

    expect(exitCode).toBe(0);
    expect(asked).toEqual(["POST /api/auth/pairing-codes", "GET /api/host/setup"]);
    expect(lines).toEqual([
      "Pairing code: K7QM-4XNP (expires in 10 min)",
      "Enter it in the AOP app or a browser at https://soulf.tailffbdec.ts.net:25650",
    ]);
  });

  test("names the other addresses too", async () => {
    const { lines } = await run({
      "/api/auth/pairing-codes": { ok: true, data: GRANT },
      "/api/host/setup": {
        ok: true,
        data: setup({ addresses: ["https://a.ts.net", "https://b.ts.net:8443"] }),
      },
    });

    expect(lines[1]).toBe(
      "Enter it in the AOP app or a browser at https://a.ts.net (or https://b.ts.net:8443)",
    );
  });

  test("on a host nothing else reaches, says so with the command that publishes it", async () => {
    const { lines } = await run({
      "/api/auth/pairing-codes": { ok: true, data: GRANT },
      "/api/host/setup": {
        ok: true,
        data: setup({
          addresses: [],
          checks: [
            {
              id: "reachable",
              state: "warning",
              title: "Reachable from your other devices",
              detail: "Only this computer can reach it.",
              actions: [
                {
                  kind: "how-to",
                  steps: [],
                  command: "tailscale serve --bg --https=443 http://127.0.0.1:25650",
                },
              ],
            },
          ],
        }),
      },
    });

    expect(lines.slice(1)).toEqual([
      "Enter it in the AOP app or a browser at this host's address.",
      "Only this computer can reach soulf now. To reach it from your other devices, run: tailscale serve --bg --https=443 http://127.0.0.1:25650",
    ]);
  });

  test("a host without the setup checklist still prints the code", async () => {
    const { exitCode, lines } = await run({ "/api/auth/pairing-codes": { ok: true, data: GRANT } });

    expect(exitCode).toBe(0);
    expect(lines).toEqual([
      "Pairing code: K7QM-4XNP (expires in 10 min)",
      "Enter it in the AOP app or a browser at this host's address.",
    ]);
  });

  test("says clearly when no host is running", async () => {
    const { exitCode, lines } = await run({
      "/api/auth/pairing-codes": new TypeError(
        "Unable to connect. Is the computer able to access the url?",
      ),
    });

    expect(exitCode).toBe(1);
    expect(lines).toEqual([
      "No AOP host answers at http://127.0.0.1:25650. Start it with `aop-nightly run` (or start its service), then run `aop-nightly pair` again.",
    ]);
  });

  test("passes on why the host refused, such as an agent asking", async () => {
    const { exitCode, lines } = await run({
      "/api/auth/pairing-codes": {
        ok: false,
        status: 403,
        error: { error: "Agents can't update or reconfigure the host they run on." },
      },
    });

    expect(exitCode).toBe(1);
    expect(lines).toEqual([
      "Couldn't make a pairing code: Agents can't update or reconfigure the host they run on.",
    ]);
  });
});
