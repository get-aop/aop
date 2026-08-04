import { describe, expect, test } from "bun:test";
import { readCreateTaskIdeaImport } from "./create-task-idea-editor";

describe("readCreateTaskIdeaImport", () => {
  test("imports markdown and selects md view", async () => {
    const file = new File(["# Title\n\nBody"], "spec.md", { type: "text/markdown" });
    const result = await readCreateTaskIdeaImport(file, "md");

    expect(result.view).toBe("md");
    expect(result.content).toContain("# Title");
  });

  test("imports html and selects html view", async () => {
    const file = new File(["<p>Hello</p>"], "page.html", { type: "text/html" });
    const result = await readCreateTaskIdeaImport(file, "html");

    expect(result.view).toBe("html");
    expect(result.content).toBe("<p>Hello</p>");
  });

  test("rejects non-markdown extensions", async () => {
    const file = new File(["text"], "notes.txt", { type: "text/plain" });
    await expect(readCreateTaskIdeaImport(file, "md")).rejects.toThrow(".md");
  });
});
