import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ExecHost, ExecHostSpawnSpec } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createExecHostsService, remoteWorkdirForTask } from "./service.ts";

const sampleHost = {
  id: "ehost_desktop",
  name: "Desktop",
  host: "192.168.1.10",
  user: "dev",
  remoteRoot: "/home/dev/aop",
};

class FakeExecHost implements ExecHost {
  readonly kind = "ssh" as const;
  private readonly scripts: Map<string, { exit: number; stdout: string }>;

  constructor(scripts: Record<string, { exit?: number; stdout?: string }> = {}) {
    this.scripts = new Map(
      Object.entries(scripts).map(([k, v]) => [k, { exit: v.exit ?? 0, stdout: v.stdout ?? "" }]),
    );
  }

  spawn(spec: ExecHostSpawnSpec): Bun.Subprocess {
    const key = spec.cmd.join(" ");
    const match = [...this.scripts.entries()].find(([pattern]) => key.includes(pattern))?.[1] ?? {
      exit: 0,
      stdout: "",
    };

    const stdoutText = match.stdout;
    return {
      pid: 42,
      exited: Promise.resolve(match.exit),
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(stdoutText));
          controller.close();
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      kill: () => {},
      unref: () => {},
    } as unknown as Bun.Subprocess;
  }

  shell(script: string): Bun.Subprocess {
    return this.spawn({ cmd: ["sh", "-lc", script] });
  }

  async commandExists(name: string): Promise<boolean> {
    const entry = this.scripts.get(`command:${name}`);
    if (entry) return entry.exit === 0;
    // Default: present for known tools
    return ["rsync", "git", "claude", "codex", "opencode"].includes(name);
  }
}

describe("exec-hosts service", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("saves and lists execution hosts", async () => {
    const service = createExecHostsService(ctx);
    const saved = await service.saveExecHosts([sampleHost]);
    expect(saved).toEqual([sampleHost]);
    expect(await service.listExecHosts()).toEqual([sampleHost]);
    expect(await service.getExecHost("ehost_desktop")).toEqual(sampleHost);
    expect(await service.getExecHost("missing")).toBeNull();
  });

  test("rejects invalid host configs on save", async () => {
    const service = createExecHostsService(ctx);
    expect(() =>
      service.saveExecHosts([
        { id: "x", name: "Bad", host: "", remoteRoot: "/tmp" } as typeof sampleHost,
      ]),
    ).toThrow();
  });

  test("createSshExecHostForTask maps worktree to remoteRoot/taskId", () => {
    const service = createExecHostsService(ctx);
    const host = service.createSshExecHostForTask(sampleHost, {
      worktreePath: "/local/wt",
      taskId: "task_abc",
    });
    expect(host.kind).toBe("ssh");
    expect(remoteWorkdirForTask(sampleHost, "task_abc")).toBe("/home/dev/aop/task_abc");
  });

  test("testExecHost reports reachability, tools, and CLIs via injected host", async () => {
    const fake = new FakeExecHost({
      "aop-ok": { exit: 0, stdout: "aop-ok\n" },
      "command:rsync": { exit: 0 },
      "command:git": { exit: 0 },
    });
    // Override commandExists for CLI probes
    fake.commandExists = async (name: string) =>
      name === "rsync" || name === "git" || name === "claude" || name === "codex";

    const service = createExecHostsService(ctx, {
      createProbeHost: () => fake,
    });
    await service.saveExecHosts([sampleHost]);

    const result = await service.testExecHost("ehost_desktop");
    expect(result.reachable).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.rsync).toBe(true);
    expect(result.git).toBe(true);
    expect(result.clis.map((c) => c.id)).toContain("claude-code");
    expect(result.clis.map((c) => c.id)).toContain("codex-cli");
    expect(result.clis.map((c) => c.id)).toContain("opencode");
    const claude = result.clis.find((c) => c.id === "claude-code");
    expect(claude?.installed).toBe(true);
  });

  test("testExecHost returns not found for unknown id", async () => {
    const service = createExecHostsService(ctx);
    const result = await service.testExecHost("missing");
    expect(result.reachable).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  test("resolveStepExecHost: null for local steps, host for bound steps, throws for stale ids", async () => {
    const service = createExecHostsService(ctx);
    await service.saveExecHosts([sampleHost]);
    const input = { worktreePath: "/local/wt", taskId: "task_abc" };

    expect(await service.resolveStepExecHost(undefined, input)).toBeNull();

    const resolved = await service.resolveStepExecHost("ehost_desktop", input);
    expect(resolved?.config).toEqual(sampleHost);
    expect(resolved?.host.kind).toBe("ssh");

    await expect(service.resolveStepExecHost("ehost_missing", input)).rejects.toThrow(
      /not configured/,
    );
  });
});
