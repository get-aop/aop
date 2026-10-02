import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ArtifactDetail } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { json, mockHost } from "../thread/test-utils";

setupDashboardDom();

let mermaidValid = true;
mock.module("./mermaid", () => ({
  renderMermaid: async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
  lazyMermaidPlugin: {
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid: () => ({}),
  },
  checkMermaid: async () =>
    mermaidValid ? { valid: true } : { valid: false, error: "Parse error" },
  loadMermaid: async () => ({}),
}));

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ArtifactPane } = await import("./ArtifactPane");
const { parseRoute } = await import("../../shell/router");
const { resetVisualizeJobs } = await import("./visualize/visualize-store");
const { Toaster } = await import("@/ui/sonner");

let host: ReturnType<typeof mockHost>;
beforeEach(() => {
  host = mockHost();
  resetVisualizeJobs();
  mermaidValid = true;
});
afterEach(() => {
  cleanup();
  host.restore();
});

const detail = (id: string, overrides: Partial<ArtifactDetail> = {}): ArtifactDetail => ({
  id,
  title: "Build report",
  kind: "json",
  language: null,
  name: "report.json",
  folder: "Artifacts",
  currentVersion: 2,
  versions: [
    {
      version: 1,
      size: 9,
      mimeType: "application/json",
      kind: "json",
      note: null,
      createdAt: "2026-10-02T00:00:00.000Z",
      messageId: null,
    },
    {
      version: 2,
      size: 9,
      mimeType: "application/json",
      kind: "json",
      note: "Added b",
      createdAt: "2026-10-02T01:00:00.000Z",
      messageId: null,
    },
  ],
  versioned: true,
  originMessageId: null,
  originType: null,
  expiresAt: null,
  ...overrides,
});

const file = (body: string, mimeType: string) =>
  new Response(body, {
    headers: { "Content-Type": "text/plain", "X-Artifact-Mime-Type": mimeType },
  });

/** Answers by the end of the path; anything else gets an empty JSON body. */
const byPath =
  (routes: [string, () => Response | Promise<Response>][]) =>
  ({ url }: { url: string }) =>
    (routes.find(([suffix]) => url.endsWith(suffix))?.[1] ?? (() => json({})))();

/** The pane on the screen the address names, as the layout would mount it. */
const mount = (path: string) => {
  window.history.pushState({}, "", path);
  const route = parseRoute(path);
  if (route?.name !== "project" && route?.name !== "thread")
    throw new Error("not a project screen");
  if (!route.artifact) throw new Error("no artifact view");
  return render(
    <>
      <ArtifactPane projectId="p1" artifact={route.artifact} />
      <Toaster />
    </>,
  );
};

describe("the artifact view", () => {
  test("loads the artifact at the version asked for, with its toolbar", async () => {
    host.respondWith(({ url }) =>
      url.endsWith("/artifacts/lib_a")
        ? json({ artifact: detail("lib_a") })
        : url.endsWith("/versions/2/content")
          ? file('{"a":1,"b":2}', "application/json")
          : json({}, 404),
    );
    mount("/projects/p1/artifacts/lib_a");
    await waitFor(() => expect(screen.getByTestId("artifact-json")).toBeTruthy());
    expect(screen.getByTestId("artifact-pane-title").textContent).toBe("Build report");
    expect(screen.getByTestId("artifact-kind").textContent).toBe("JSON");
    expect(screen.getByTestId("artifact-version-menu").textContent).toContain("v2of 2");

    fireEvent.click(screen.getByTestId("artifact-source"));
    await waitFor(() => expect(screen.getByTestId("artifact-code")).toBeTruthy());
    fireEvent.click(screen.getByTestId("artifact-preview"));
    expect(screen.getByTestId("artifact-json")).toBeTruthy();
  });

  test("copies the version's text", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
    host.respondWith(({ url }) =>
      url.endsWith("/artifacts/lib_b")
        ? json({
            artifact: detail("lib_b", {
              currentVersion: 1,
              versions: detail("lib_b").versions.slice(0, 1),
            }),
          })
        : file('{"a":1}', "application/json"),
    );
    mount("/projects/p1/artifacts/lib_b");
    await waitFor(() => expect(screen.getByTestId("artifact-copy")).toBeTruthy());
    await act(async () => fireEvent.click(screen.getByTestId("artifact-copy")));
    expect(copied).toEqual(['{"a":1}']);
    // One version: nothing to switch between.
    expect(screen.queryByTestId("artifact-version-menu")).toBeNull();
  });

  test("Escape leaves full screen first, then gives the chat its place back", async () => {
    host.respondWith(({ url }) =>
      url.endsWith("/artifacts/lib_c")
        ? json({ artifact: detail("lib_c") })
        : file("{}", "application/json"),
    );
    mount("/projects/p1/threads/t1/artifacts/lib_c");
    await waitFor(() => expect(screen.getByTestId("artifact-fullscreen")).toBeTruthy());

    fireEvent.click(screen.getByTestId("artifact-fullscreen"));
    expect(screen.getByTestId("artifact-pane").getAttribute("data-fullscreen")).toBe("true");
    act(() => void fireEvent.keyDown(document.body, { key: "Escape" }));
    expect(screen.getByTestId("artifact-pane").getAttribute("data-fullscreen")).toBeNull();
    expect(window.location.pathname).toBe("/projects/p1/threads/t1/artifacts/lib_c");

    act(() => void fireEvent.keyDown(document.body, { key: "Escape" }));
    expect(window.location.pathname).toBe("/projects/p1/threads/t1");
  });

  test("an artifact no longer in the Library says so", async () => {
    host.respondWith(() =>
      json({ error: "That artifact is no longer in the Library", code: "ARTIFACT_NOT_FOUND" }, 404),
    );
    mount("/projects/p1/artifacts/lib_gone");
    await waitFor(() =>
      expect(screen.getByTestId("artifact-failed").textContent).toContain(
        "no longer in the Library",
      ),
    );
  });

  test("a linked workspace file opens read only and can be kept in the Library", async () => {
    host.respondWith(({ url, method }) => {
      if (method === "POST")
        return json({ artifact: detail("lib_saved", { kind: "markdown" }) }, 201);
      if (url.includes("/workspace-files?")) return file("# Plan", "text/markdown");
      if (url.endsWith("/artifacts/lib_saved"))
        return json({
          artifact: detail("lib_saved", {
            kind: "markdown",
            currentVersion: 1,
            versions: detail("x").versions.slice(0, 1),
          }),
        });
      return file("# Plan", "text/markdown");
    });
    mount("/projects/p1/files/t1/docs%2Fplan.md");
    await waitFor(() => expect(screen.getByTestId("artifact-markdown")).toBeTruthy());
    expect(host.to("/projects/p1/workspace-files?path=docs%2Fplan.md&threadId=t1")).toHaveLength(1);

    await act(async () => fireEvent.click(screen.getByTestId("artifact-save-library")));
    expect(host.to("/workspace-files/save", "POST")[0]?.body).toEqual({
      threadId: "t1",
      path: "docs/plan.md",
    });
    expect(window.location.pathname).toBe("/projects/p1/artifacts/lib_saved");
  });
});

describe("Visualize in the view", () => {
  const drawn = (source: string) =>
    json({ candidate: { kind: "mermaid", source }, durationMs: 5, costUsd: 0.0015 });

  test("shows each step, then the saved diagram in its place", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    host.respondWith(async ({ url }) => {
      if (url.endsWith("/visualize/m1")) return json({ artifact: null });
      if (url.endsWith("/visualize/generate")) {
        await held;
        return drawn("flowchart TD\nA-->B");
      }
      if (url.endsWith("/visualize/save"))
        return json({
          artifact: detail("lib_d", { kind: "mermaid", currentVersion: 1, originMessageId: "m1" }),
        });
      return json({});
    });
    mount("/projects/p1/visualize/m1");
    await waitFor(() =>
      expect(document.querySelector('[data-phase="drawing"]')?.getAttribute("data-state")).toBe(
        "active",
      ),
    );
    expect(document.querySelector('[data-phase="cache"]')?.getAttribute("data-state")).toBe("done");
    await act(async () => release());
    await waitFor(() => expect(window.location.pathname).toBe("/projects/p1/artifacts/lib_d/1"));
    expect(host.to("/visualize/save", "POST")[0]?.body).toMatchObject({
      messageId: "m1",
      result: "diagram",
      candidate: { source: "flowchart TD\nA-->B" },
    });
  });

  test("a diagram that will not parse is repaired, then kept as the outline", async () => {
    mermaidValid = false;
    host.respondWith(
      byPath([
        ["/visualize/m2", () => json({ artifact: null })],
        ["/visualize/generate", () => drawn("flowchart TD\nA-->")],
        ["/visualize/repair", () => drawn("still broken")],
        ["/visualize/save", () => json({ artifact: detail("lib_e", { currentVersion: 1 }) })],
      ]),
    );
    mount("/projects/p1/visualize/m2");
    await waitFor(() => expect(window.location.pathname).toBe("/projects/p1/artifacts/lib_e/1"));
    expect(host.to("/visualize/repair", "POST")[0]?.body).toMatchObject({ error: "Parse error" });
    expect(host.to("/visualize/save", "POST")[0]?.body).toMatchObject({ result: "outline" });
  });
});

describe("a diagram Visualize made", () => {
  test("says when it is the outline fallback, and Regenerate draws a new version", async () => {
    const outline = detail("lib_f", {
      kind: "markdown",
      currentVersion: 1,
      originMessageId: "m3",
      originType: "flowchart",
      versions: [
        {
          version: 1,
          size: 9,
          mimeType: "text/markdown",
          kind: "markdown",
          note: "Outline (no valid diagram)",
          createdAt: "2026-10-02T00:00:00.000Z",
          messageId: null,
        },
      ],
    });
    const redrawn = detail("lib_f", {
      kind: "mermaid",
      currentVersion: 2,
      originMessageId: "m3",
      originType: "flowchart",
      versions: [
        ...outline.versions,
        {
          version: 2,
          size: 9,
          mimeType: "text/plain",
          kind: "mermaid",
          note: "Flowchart",
          createdAt: "2026-10-02T01:00:00.000Z",
          messageId: null,
        },
      ],
    });
    let saved = false;
    host.respondWith(
      byPath([
        ["/artifacts/lib_f", () => json({ artifact: saved ? redrawn : outline })],
        ["/versions/1/content", () => file("# Outline", "text/markdown")],
        ["/versions/2/content", () => file("flowchart TD\nA-->B", "text/plain")],
        [
          "/visualize/generate",
          () =>
            json({
              candidate: { kind: "mermaid", source: "flowchart TD\nA-->B" },
              durationMs: 5,
              costUsd: 0.0015,
            }),
        ],
        [
          "/visualize/save",
          () => {
            saved = true;
            return json({ artifact: redrawn });
          },
        ],
      ]),
    );
    mount("/projects/p1/artifacts/lib_f");
    await waitFor(() => expect(screen.getByTestId("visualize-fallback")).toBeTruthy());

    await act(async () => fireEvent.click(screen.getByTestId("visualize-regenerate")));
    await waitFor(() => expect(window.location.pathname).toBe("/projects/p1/artifacts/lib_f/2"));
    expect(host.to("/visualize/generate", "POST")[0]?.body).toEqual({
      messageId: "m3",
      type: "flowchart",
    });
    // A fresh drawing never reuses the saved one.
    expect(host.to("/visualize/m3")).toHaveLength(0);
  });
});
