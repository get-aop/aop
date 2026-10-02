import { describe, expect, test } from "bun:test";
import type { ArtifactDetail, VisualizeCandidate } from "@aop/common";
import { runVisualize, type VisualizeJob, type VisualizeSteps } from "./visualize-job";

const artifact = (id: string): ArtifactDetail => ({
  id,
  title: "Diagram",
  kind: "mermaid",
  language: null,
  name: "d.mmd",
  folder: "Artifacts/Diagrams",
  currentVersion: 1,
  versions: [],
  versioned: true,
  originMessageId: "m1",
  originType: "auto",
  expiresAt: null,
});

const mermaid = (source: string): VisualizeCandidate => ({ kind: "mermaid", source });
const drawn = (candidate: VisualizeCandidate, costUsd = 0.001) => ({
  candidate,
  durationMs: 10,
  costUsd,
});

/** Steps that record what ran; each can be replaced per test. */
const steps = (overrides: Partial<VisualizeSteps> = {}) => {
  const calls: string[] = [];
  const record = <T>(name: string, value: T) => {
    calls.push(name);
    return value;
  };
  const all: VisualizeSteps = {
    existing: async () => record("existing", null),
    generate: async () => record("generate", drawn(mermaid("flowchart TD\nA-->B"))),
    repair: async () => record("repair", drawn(mermaid("flowchart TD\nA-->C"))),
    check: async (source) =>
      record(`check:${source}`, source.includes("-->") && !source.endsWith("-->")
        ? { valid: true as const }
        : { valid: false as const, error: "Parse error" }),
    saveDiagram: async (_type, candidate) => record(`saveDiagram:${candidate.source}`, artifact("a1")),
    saveOutline: async () => record("saveOutline", artifact("a2")),
    ...overrides,
  };
  return { all, calls };
};

const run = async (s: VisualizeSteps, fresh = false, type: "auto" | "table" = "auto") => {
  const reported: VisualizeJob[] = [];
  const result = await runVisualize(s, type, fresh, (job) => reported.push(job));
  return { result, phases: reported.map((job) => (job.status === "running" ? job.phase : job.status)) };
};

describe("runVisualize", () => {
  test("opens the diagram already made of the reply without drawing", async () => {
    const s = steps({ existing: async () => artifact("old") });
    const { result, phases } = await run(s.all);
    expect(result).toMatchObject({ status: "done", cached: true, artifact: { id: "old" } });
    expect(phases).toEqual(["cache"]);
  });

  test("draws, checks and saves a diagram that parses, and adds up what it cost", async () => {
    const s = steps();
    const { result, phases } = await run(s.all);
    expect(phases).toEqual(["cache", "drawing", "checking", "saving"]);
    expect(s.calls).toEqual(["existing", "generate", "check:flowchart TD\nA-->B", "saveDiagram:flowchart TD\nA-->B"]);
    expect(result).toMatchObject({ status: "done", fallback: false, cached: false, costUsd: 0.001 });
  });

  test("repairs a diagram that does not parse, once, with the parser's words", async () => {
    let repairedWith = "";
    const s = steps({
      generate: async () => drawn(mermaid("flowchart TD\nA-->")),
      repair: async (_type, _source, error) => {
        repairedWith = error;
        return drawn(mermaid("flowchart TD\nA-->C"), 0.002);
      },
    });
    const { result, phases } = await run(s.all, true);
    expect(phases).toEqual(["drawing", "checking", "repairing", "checking", "saving"]);
    expect(repairedWith).toBe("Parse error");
    expect(result).toMatchObject({ status: "done", fallback: false, costUsd: 0.003 });
    expect(s.calls.at(-1)).toBe("saveDiagram:flowchart TD\nA-->C");
  });

  test("keeps the outline when the repair does not parse either, or the model gave nothing", async () => {
    const broken = steps({
      generate: async () => drawn(mermaid("flowchart TD\nA-->")),
      repair: async () => drawn(mermaid("still -->")),
    });
    expect((await run(broken.all, true)).result).toMatchObject({ status: "done", fallback: true, artifact: { id: "a2" } });
    expect(broken.calls.at(-1)).toBe("saveOutline");

    const silent = steps({ generate: async () => Promise.reject(new Error("502")) });
    expect((await run(silent.all, true)).result).toMatchObject({ status: "done", fallback: true });
    expect(silent.calls).toEqual(["saveOutline"]);
  });

  test("a table needs no check; a save that fails is a failed run", async () => {
    const table = steps({ generate: async () => drawn({ kind: "markdown", source: "| a |\n| - |" }) });
    const { phases } = await run(table.all, true, "table");
    expect(phases).toEqual(["drawing", "saving"]);
    expect(table.calls).toEqual(["saveDiagram:| a |\n| - |"]);

    const failing = steps({ saveDiagram: async () => Promise.reject(new Error("Library full")) });
    expect((await run(failing.all, true)).result).toMatchObject({ status: "failed", error: "Library full" });
  });
});
