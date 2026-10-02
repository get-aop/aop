import { describe, expect, test } from "bun:test";
import {
  ARTIFACT_RESULT_MARKER,
  artifactKindOf,
  codeLanguageOf,
  formatArtifactMarker,
  parseArtifactMarker,
  VisualizeSaveInputSchema,
} from "./artifacts.ts";
import { TurnPartSchema } from "./projects/blocks.ts";

describe("artifactKindOf", () => {
  test("reads the extension first, then the MIME type", () => {
    expect(artifactKindOf("plan.md", "text/plain")).toBe("markdown");
    expect(artifactKindOf("report.JSON", "text/plain")).toBe("json");
    expect(artifactKindOf("data.tsv", "text/plain")).toBe("csv");
    expect(artifactKindOf("flow.mmd", "text/plain")).toBe("mermaid");
    expect(artifactKindOf("page.htm", "text/plain")).toBe("html");
    expect(artifactKindOf("main.rs", "text/plain")).toBe("code");
    expect(artifactKindOf("logo", "image/svg+xml")).toBe("svg");
    expect(artifactKindOf("shot", "image/png")).toBe("image");
    expect(artifactKindOf("paper", "application/pdf")).toBe("pdf");
    expect(artifactKindOf("blob", "application/json")).toBe("json");
    expect(artifactKindOf("notes", "application/octet-stream")).toBe("text");
  });

  test("names the highlighter language of a code file", () => {
    expect(codeLanguageOf("app.tsx")).toBe("tsx");
    expect(codeLanguageOf("run.py")).toBe("python");
    expect(codeLanguageOf("README")).toBeNull();
  });
});

describe("artifact marker", () => {
  const ref = {
    artifactId: "lib_1",
    version: 2,
    title: "Release plan",
    kind: "markdown" as const,
    action: "updated" as const,
  };

  test("round-trips on the last marker line of a tool result", () => {
    const text = `Saved.\n${formatArtifactMarker({ ...ref, version: 1 })}\n${formatArtifactMarker(ref)}`;
    expect(parseArtifactMarker(text)).toEqual(ref);
  });

  test("is null without a marker, with broken JSON, or with a wrong shape", () => {
    expect(parseArtifactMarker("Saved the file")).toBeNull();
    expect(parseArtifactMarker(`${ARTIFACT_RESULT_MARKER}{oops`)).toBeNull();
    expect(parseArtifactMarker(`${ARTIFACT_RESULT_MARKER}{"artifactId":"x","version":0}`)).toBeNull();
    expect(
      parseArtifactMarker(formatArtifactMarker({ ...ref, kind: "exe" as unknown as "json" })),
    ).toBeNull();
  });

  test("an artifact part is a turn part", () => {
    expect(TurnPartSchema.parse({ type: "artifact", toolId: "t", ...ref })).toEqual({
      type: "artifact",
      toolId: "t",
      ...ref,
    });
  });
});

describe("VisualizeSaveInputSchema", () => {
  test("takes a checked diagram or the outline fallback, nothing else", () => {
    expect(
      VisualizeSaveInputSchema.safeParse({
        messageId: "m",
        type: "flowchart",
        result: "diagram",
        candidate: { kind: "mermaid", source: "flowchart TD\nA-->B" },
      }).success,
    ).toBe(true);
    expect(
      VisualizeSaveInputSchema.safeParse({ messageId: "m", type: "auto", result: "outline" })
        .success,
    ).toBe(true);
    expect(
      VisualizeSaveInputSchema.safeParse({
        messageId: "m",
        type: "auto",
        result: "diagram",
        candidate: { kind: "mermaid", source: "" },
      }).success,
    ).toBe(false);
  });
});
