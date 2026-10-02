import { describe, expect, test } from "bun:test";
import { checkArtifactContent } from "./content-check.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("checkArtifactContent", () => {
  test("accepts what each kind's view can draw", () => {
    expect(checkArtifactContent("json", bytes('{"a":[1]}'), "application/json")).toBeNull();
    expect(checkArtifactContent("csv", bytes("a,b\n1,2"), "text/csv")).toBeNull();
    expect(
      checkArtifactContent("mermaid", bytes("%% note\nsequenceDiagram\nA->>B: x"), "text/plain"),
    ).toBeNull();
    expect(
      checkArtifactContent(
        "mermaid",
        bytes("---\ntitle: T\n---\nflowchart LR\nA-->B"),
        "text/plain",
      ),
    ).toBeNull();
    expect(checkArtifactContent("svg", bytes('<svg xmlns="x"></svg>'), "image/svg+xml")).toBeNull();
    expect(checkArtifactContent("html", bytes("<p>hi</p>"), "text/html")).toBeNull();
    expect(checkArtifactContent("image", bytes("x"), "image/png")).toBeNull();
    expect(checkArtifactContent("pdf", bytes("x"), "application/pdf")).toBeNull();
  });

  test("names what is wrong otherwise", () => {
    expect(checkArtifactContent("json", bytes("{"), "text/plain")).toContain("not valid JSON");
    expect(checkArtifactContent("csv", bytes("\n1,2"), "text/csv")).toContain("header row");
    expect(checkArtifactContent("mermaid", bytes("```mermaid\ngraph TD"), "text/plain")).toContain(
      "diagram type",
    );
    expect(checkArtifactContent("svg", bytes("<p/>"), "text/plain")).toContain("<svg>");
    expect(checkArtifactContent("image", bytes("<svg/>"), "image/svg+xml")).toContain("PNG");
    expect(checkArtifactContent("pdf", bytes("x"), "text/plain")).toContain("PDF");
    expect(checkArtifactContent("markdown", Uint8Array.of(0xff, 0xfe), "text/plain")).toContain(
      "UTF-8",
    );
  });
});
