import { describe, expect, test } from "bun:test";
import { artifactFileName } from "./naming.ts";

describe("artifactFileName", () => {
  test("keeps the agent's name, else the path's, else makes one from the title and kind", () => {
    expect(artifactFileName({ title: "T", name: " notes.txt " })).toBe("notes.txt");
    expect(artifactFileName({ title: "T", path: "out/chart.png" })).toBe("chart.png");
    expect(artifactFileName({ title: "Release plan" })).toBe("release-plan.md");
    expect(artifactFileName({ title: "Données: été!", kind: "json" })).toBe("donnees-ete.json");
    expect(artifactFileName({ title: "Fix", kind: "code", language: "TypeScript" })).toBe("fix.ts");
    expect(artifactFileName({ title: "Fix", kind: "code", language: "cobol" })).toBe("fix.txt");
    expect(artifactFileName({ title: "!!!", kind: "mermaid" })).toBe("artifact.mmd");
    expect(artifactFileName({ title: "x".repeat(100) }).length).toBe(63);
  });
});
