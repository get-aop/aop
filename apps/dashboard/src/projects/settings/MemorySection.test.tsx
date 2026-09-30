import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MemoryFile, Project } from "@aop/common";
import { mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import type { ProjectStreamEvent } from "../live-projects";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../test-utils";
import { AT, makeMemoryFile } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ConfirmationHost } = await import("../../components/ConfirmationHost");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { MemorySection } = await import("./MemorySection");

const project = makeProject({ id: "p1", name: "Checkout", instructions: "Never touch payments." });
const index = makeMemoryFile({
  name: "MEMORY.md",
  description: "The index",
  body: "- testing.md: how to test",
  updatedAt: "2026-09-29T09:00:00.000Z",
});
const testing = makeMemoryFile();

let api: ReturnType<typeof mockApi>;
let files: MemoryFile[];
let respond: (method: string, path: string, body: unknown) => Response | undefined;
let listeners: Set<(event: ProjectStreamEvent) => void>;

beforeEach(() => {
  window.localStorage.clear();
  files = [index, testing];
  respond = () => undefined;
  listeners = new Set();
  api = mockApi((call) => {
    if (call.method === "GET" && call.path === "/projects/p1/memory") {
      return Response.json({ files });
    }
    const memoryName = call.path.match(/^\/projects\/p1\/memory\/(.+)$/)?.[1];
    if (call.method === "PUT" && memoryName) {
      const saved = {
        ...(call.body as { description: string; body: string }),
        name: decodeURIComponent(memoryName),
        updatedAt: "2026-09-30T12:00:00.000Z",
      };
      files = [...files.filter((file) => file.name !== saved.name), saved];
      return Response.json({ file: saved });
    }
    if (call.method === "DELETE" && memoryName) {
      files = files.filter((file) => file.name !== decodeURIComponent(memoryName));
      return new Response(null, { status: 204 });
    }
    return respond(call.method, call.path, call.body);
  });
});

afterEach(() => {
  cleanup();
  api.restore();
});

const renderMemory = (current: Project = project) => {
  const stub = stubLiveProjects(makeState([makeEntry(current)]));
  const live = {
    ...stub.live,
    subscribeEvents: (_projectId: string, listener: (event: ProjectStreamEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  render(
    <ProjectsProvider live={live}>
      <MemorySection project={current} />
      <ConfirmationHost />
    </ProjectsProvider>,
  );
  return stub;
};

const fileRow = (name: string) =>
  screen.getAllByTestId("memory-file").find((row) => row.getAttribute("data-name") === name);

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const memoryWrites = () =>
  api.writes().filter((call) => call.path.startsWith("/projects/p1/memory"));

describe("instructions", () => {
  test("count characters against the limit as the person types", async () => {
    renderMemory();
    await screen.findByTestId("memory-editor");
    expect(screen.getByTestId("settings-instructions-count").textContent).toBe("21 / 16000");

    type("settings-instructions", "twelve chars");
    expect(screen.getByTestId("settings-instructions-count").textContent).toBe("12 / 16000");
    expect(screen.getByTestId("settings-instructions-count").getAttribute("data-near-limit")).toBe(
      "false",
    );
  });

  test("the counter turns to a warning near the limit", async () => {
    renderMemory();
    await screen.findByTestId("memory-editor");
    type("settings-instructions", "x".repeat(14_500));
    expect(screen.getByTestId("settings-instructions-count").getAttribute("data-near-limit")).toBe(
      "true",
    );
  });

  test("Save sends only the instructions, and stays disabled until they change", async () => {
    respond = (method, path, body) =>
      method === "PATCH" && path === "/projects/p1"
        ? Response.json({ project: { ...project, ...(body as object) } })
        : undefined;
    const stub = renderMemory();
    await screen.findByTestId("memory-editor");
    const saveButton = screen.getByTestId("settings-instructions-save") as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    type("settings-instructions", "Never touch payments.\nAsk before migrations.");
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(api.writes().filter((call) => call.method === "PATCH")).toEqual([
        {
          method: "PATCH",
          path: "/projects/p1",
          body: { instructions: "Never touch payments.\nAsk before migrations." },
        },
      ]),
    );
    await waitFor(() => expect(stub.calls.adopted).toHaveLength(1));
  });
});

describe("memory files", () => {
  test("lists the index first, labelled, then topic files with description and updated date", async () => {
    renderMemory();
    await screen.findAllByTestId("memory-file");

    const names = screen.getAllByTestId("memory-file").map((row) => row.getAttribute("data-name"));
    expect(names).toEqual(["MEMORY.md", "testing.md"]);
    expect(
      within(fileRow("MEMORY.md") as HTMLElement).getByTestId("memory-index-label").textContent,
    ).toBe("read every thread");
    const topic = within(fileRow("testing.md") as HTMLElement);
    expect(topic.getByTestId("memory-file-description").textContent).toBe("How to run the tests");
    expect(topic.getByTestId("memory-file-updated").getAttribute("datetime")).toBe(
      testing.updatedAt,
    );
    expect(topic.getByTestId("memory-file-updated").textContent).toContain("Updated");
    expect(topic.queryByTestId("memory-index-label")).toBeNull();
  });

  test("opens the index first, and a topic file when it is picked", async () => {
    renderMemory();
    const editor = await screen.findByTestId("memory-editor");
    expect(editor.getAttribute("data-name")).toBe("MEMORY.md");
    expect((screen.getByTestId("memory-body") as HTMLTextAreaElement).value).toBe(
      "- testing.md: how to test",
    );
    expect(screen.queryByTestId("memory-description")).toBeNull();
    expect(screen.queryByTestId("memory-delete")).toBeNull();

    fireEvent.click(fileRow("testing.md") as HTMLElement);
    expect(screen.getByTestId("memory-editor").getAttribute("data-name")).toBe("testing.md");
    expect((screen.getByTestId("memory-description") as HTMLInputElement).value).toBe(
      "How to run the tests",
    );
    expect((screen.getByTestId("memory-body") as HTMLTextAreaElement).value).toBe("Run bun test.");
    expect(screen.getByTestId("memory-editor-updated").getAttribute("datetime")).toBe(
      testing.updatedAt,
    );
  });

  test("editing a topic file saves its description and body, and the list shows the new date", async () => {
    renderMemory();
    await screen.findByTestId("memory-editor");
    fireEvent.click(fileRow("testing.md") as HTMLElement);
    expect((screen.getByTestId("memory-save") as HTMLButtonElement).disabled).toBe(true);

    type("memory-description", "How to run and debug the tests");
    type("memory-body", "Run bun test.\nUse --watch to debug.");
    fireEvent.click(screen.getByTestId("memory-save"));

    await waitFor(() => expect(memoryWrites()).toHaveLength(1));
    expect(memoryWrites()[0]).toEqual({
      method: "PUT",
      path: "/projects/p1/memory/testing.md",
      body: {
        description: "How to run and debug the tests",
        body: "Run bun test.\nUse --watch to debug.",
      },
    });
    await waitFor(() =>
      expect(
        within(fileRow("testing.md") as HTMLElement)
          .getByTestId("memory-file-updated")
          .getAttribute("datetime"),
      ).toBe("2026-09-30T12:00:00.000Z"),
    );
    expect((screen.getByTestId("memory-save") as HTMLButtonElement).disabled).toBe(true);
  });

  test("a new topic file gets .md if the name lacks it, and opens once created", async () => {
    renderMemory();
    await screen.findByTestId("memory-editor");
    fireEvent.click(screen.getByTestId("memory-new"));
    expect(screen.getByTestId("memory-editor").getAttribute("data-mode")).toBe("create");

    type("memory-new-name", "deploys");
    type("memory-description", "How we deploy");
    type("memory-body", "Merge, then tag.");
    fireEvent.click(screen.getByTestId("memory-save"));

    await waitFor(() => expect(memoryWrites()).toHaveLength(1));
    expect(memoryWrites()[0]).toEqual({
      method: "PUT",
      path: "/projects/p1/memory/deploys.md",
      body: { description: "How we deploy", body: "Merge, then tag." },
    });
    await waitFor(() =>
      expect(screen.getByTestId("memory-editor").getAttribute("data-name")).toBe("deploys.md"),
    );
    expect(fileRow("deploys.md")).toBeTruthy();
  });

  test("a new file cannot take the name of one that exists, or an unsafe name", async () => {
    renderMemory();
    await screen.findByTestId("memory-editor");
    fireEvent.click(screen.getByTestId("memory-new"));

    type("memory-new-name", "testing");
    type("memory-body", "replace it");
    fireEvent.click(screen.getByTestId("memory-save"));
    expect((await screen.findByTestId("memory-error")).textContent).toBe(
      "testing.md already exists. Pick another name, or open it from the list.",
    );

    type("memory-new-name", "../etc/passwd");
    fireEvent.click(screen.getByTestId("memory-save"));
    await waitFor(() =>
      expect(screen.getByTestId("memory-error").textContent).toBe(
        "Memory file names are letters, digits, . _ - and end in .md",
      ),
    );
    expect(memoryWrites()).toHaveLength(0);
  });

  test("Cancel leaves a new file unwritten and goes back to the index", async () => {
    renderMemory();
    await screen.findByTestId("memory-editor");
    fireEvent.click(screen.getByTestId("memory-new"));
    fireEvent.click(screen.getByTestId("memory-discard"));

    expect(screen.getByTestId("memory-editor").getAttribute("data-name")).toBe("MEMORY.md");
    expect(memoryWrites()).toHaveLength(0);
  });

  test("deleting a topic file asks first, then removes it", async () => {
    renderMemory();
    await screen.findByTestId("memory-editor");
    fireEvent.click(fileRow("testing.md") as HTMLElement);

    fireEvent.click(screen.getByTestId("memory-delete"));
    await screen.findByText("Delete testing.md?");
    expect(memoryWrites()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(memoryWrites()).toHaveLength(1));
    expect(memoryWrites()[0]).toEqual({
      method: "DELETE",
      path: "/projects/p1/memory/testing.md",
      body: undefined,
    });
    await waitFor(() => expect(fileRow("testing.md")).toBeUndefined());
    expect(screen.getByTestId("memory-editor").getAttribute("data-name")).toBe("MEMORY.md");
  });

  test("a project with no memory says so and still takes a note", async () => {
    files = [];
    renderMemory();
    expect((await screen.findByTestId("memory-empty")).textContent).toContain("No memory yet");
    expect(screen.queryAllByTestId("memory-file")).toHaveLength(0);
  });

  test("a memory list that cannot be loaded says why", async () => {
    respond = () => undefined;
    api.restore();
    api = mockApi(() => Response.json({ error: "Database is locked" }, { status: 500 }));
    renderMemory();
    expect((await screen.findByTestId("memory-load-error")).textContent).toBe("Database is locked");
  });
});

describe("quick note", () => {
  test("adds the note as a line at the end of the index", async () => {
    renderMemory();
    await screen.findByTestId("memory-editor");

    type("memory-quick-note-input", "  Deploys freeze on Fridays  ");
    fireEvent.click(screen.getByTestId("memory-quick-note-add"));

    await waitFor(() => expect(memoryWrites()).toHaveLength(1));
    expect(memoryWrites()[0]).toEqual({
      method: "PUT",
      path: "/projects/p1/memory/MEMORY.md",
      body: {
        description: "The index",
        body: "- testing.md: how to test\n- Deploys freeze on Fridays\n",
      },
    });
    expect((await screen.findByTestId("memory-quick-note-message")).textContent).toBe(
      "Added to MEMORY.md.",
    );
    expect((screen.getByTestId("memory-quick-note-input") as HTMLInputElement).value).toBe("");
    await waitFor(() =>
      expect((screen.getByTestId("memory-body") as HTMLTextAreaElement).value).toBe(
        "- testing.md: how to test\n- Deploys freeze on Fridays\n",
      ),
    );
  });

  test("creates the index when the project has none", async () => {
    files = [];
    renderMemory();
    await screen.findByTestId("memory-empty");

    type("memory-quick-note-input", "Use pnpm");
    fireEvent.click(screen.getByTestId("memory-quick-note-add"));

    await waitFor(() => expect(memoryWrites()).toHaveLength(1));
    expect(memoryWrites()[0]).toEqual({
      method: "PUT",
      path: "/projects/p1/memory/MEMORY.md",
      body: {
        description: "What the project's sessions need to know first.",
        body: "- Use pnpm\n",
      },
    });
  });

  test("Add stays disabled for an empty note", async () => {
    renderMemory();
    await screen.findByTestId("memory-editor");
    expect((screen.getByTestId("memory-quick-note-add") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("a file that changes on the host", () => {
  const messageCreated: ProjectStreamEvent = {
    kind: "entry",
    entry: {
      id: 1,
      projectId: "p1",
      type: "message.created",
      payload: {
        message: {
          id: "msg_1",
          projectId: "p1",
          threadId: null,
          role: "user",
          text: "hello",
          createdAt: AT,
        },
      },
    },
  };
  // The list is reloaded a moment after a message arrives; wait that moment inside act.
  const announceMessage = () =>
    act(async () => {
      for (const listener of listeners) listener(messageCreated);
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

  test("shows the newer copy when the person has no edits", async () => {
    renderMemory();
    await screen.findByTestId("memory-editor");
    files = [
      { ...index, body: "- written by the coordinator", updatedAt: "2026-09-30T11:00:00.000Z" },
      testing,
    ];

    await announceMessage();

    await waitFor(() =>
      expect((screen.getByTestId("memory-body") as HTMLTextAreaElement).value).toBe(
        "- written by the coordinator",
      ),
    );
    expect(screen.queryByTestId("memory-changed-notice")).toBeNull();
  });

  test("keeps the person's edits and offers the newer copy instead", async () => {
    renderMemory();
    await screen.findByTestId("memory-editor");
    type("memory-body", "my edit");
    files = [
      { ...index, body: "- written by the coordinator", updatedAt: "2026-09-30T11:00:00.000Z" },
      testing,
    ];

    await announceMessage();

    await screen.findByTestId("memory-changed-notice");
    expect((screen.getByTestId("memory-body") as HTMLTextAreaElement).value).toBe("my edit");

    fireEvent.click(screen.getByTestId("memory-load-newer"));
    expect((screen.getByTestId("memory-body") as HTMLTextAreaElement).value).toBe(
      "- written by the coordinator",
    );
    expect(screen.queryByTestId("memory-changed-notice")).toBeNull();
  });
});
