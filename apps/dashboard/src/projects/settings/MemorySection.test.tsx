import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MemoryFile, Message, Project } from "@aop/common";
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

const project = makeProject({ id: "p1", name: "Checkout" });
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
  screen.queryAllByTestId("memory-file").find((row) => row.getAttribute("data-name") === name);

const openFile = async (name: string) => {
  await waitFor(() => expect(fileRow(name)).toBeTruthy());
  fireEvent.click(fileRow(name) as HTMLElement);
  return screen.getByTestId("memory-editor");
};

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const memoryWrites = () =>
  api.writes().filter((call) => call.path.startsWith("/projects/p1/memory"));

const announce = (message: Message) =>
  act(async () => {
    for (const listener of listeners) {
      listener({
        kind: "entry",
        entry: { id: 1, projectId: "p1", type: "message.created", payload: { message } },
      });
    }
    // The list is reloaded a moment after a message arrives; wait that moment inside act.
    await new Promise((resolve) => setTimeout(resolve, 700));
  });

const userMessage: Message = {
  id: "msg_1",
  projectId: "p1",
  threadId: null,
  role: "user",
  text: "hello",
  createdAt: AT,
};

describe("the memory list", () => {
  test("puts the index under Read every thread and topic files under Memory files", async () => {
    renderMemory();
    await screen.findAllByTestId("memory-file");

    const names = (group: string) =>
      within(screen.getByTestId(group))
        .getAllByTestId("memory-file")
        .map((row) => row.getAttribute("data-name"));
    expect(names("memory-index-group")).toEqual(["MEMORY.md"]);
    expect(names("memory-topic-group")).toEqual(["testing.md"]);
    const topic = within(fileRow("testing.md") as HTMLElement);
    expect(topic.getByTestId("memory-file-description").textContent).toBe("How to run the tests");
    expect(topic.getByTestId("memory-file-updated").getAttribute("datetime")).toBe(AT);
    expect(topic.getByTestId("memory-file-updated").textContent).toMatch(/^Updated /);
    // Read first: no editor until a file is opened.
    expect(screen.queryByTestId("memory-editor")).toBeNull();
  });

  test("a row opens its file in an editor in place of the list, and All memory goes back", async () => {
    renderMemory();
    const editor = await openFile("testing.md");
    expect(editor.getAttribute("data-name")).toBe("testing.md");
    expect((screen.getByTestId("memory-description") as HTMLInputElement).value).toBe(
      "How to run the tests",
    );
    expect((screen.getByTestId("memory-body") as HTMLTextAreaElement).value).toBe("Run bun test.");
    expect(screen.queryByTestId("memory-files")).toBeNull();

    fireEvent.click(screen.getByTestId("memory-back"));
    expect(screen.queryByTestId("memory-editor")).toBeNull();

    await openFile("MEMORY.md");
    expect((screen.getByTestId("memory-body") as HTMLTextAreaElement).value).toBe(
      "- testing.md: how to test",
    );
    // The index has no description to edit and cannot be deleted.
    expect(screen.queryByTestId("memory-description")).toBeNull();
    expect(screen.queryByTestId("memory-delete")).toBeNull();
  });

  test("editing a topic file saves its description and body, and the list shows the new date", async () => {
    renderMemory();
    await openFile("testing.md");
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
      expect((screen.getByTestId("memory-save") as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.click(screen.getByTestId("memory-back"));
    expect(
      within(fileRow("testing.md") as HTMLElement)
        .getByTestId("memory-file-updated")
        .getAttribute("datetime"),
    ).toBe("2026-09-30T12:00:00.000Z");
  });

  test("a new topic file gets .md if the name lacks it, and stays open once created", async () => {
    renderMemory();
    await screen.findAllByTestId("memory-file");
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
    fireEvent.click(screen.getByTestId("memory-back"));
    expect(fileRow("deploys.md")).toBeTruthy();
  });

  test("a new file cannot take the name of one that exists, or an unsafe name", async () => {
    renderMemory();
    await screen.findAllByTestId("memory-file");
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

  test("Cancel leaves a new file unwritten and goes back to the list", async () => {
    renderMemory();
    await screen.findAllByTestId("memory-file");
    fireEvent.click(screen.getByTestId("memory-new"));
    fireEvent.click(screen.getByTestId("memory-discard"));

    expect(screen.queryByTestId("memory-editor")).toBeNull();
    expect(screen.getByTestId("memory-files")).toBeTruthy();
    expect(memoryWrites()).toHaveLength(0);
  });

  test("deleting a topic file asks first, then removes it and goes back to the list", async () => {
    renderMemory();
    await openFile("testing.md");

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
    await waitFor(() => expect(screen.queryByTestId("memory-editor")).toBeNull());
    expect(fileRow("testing.md")).toBeUndefined();
    expect(fileRow("MEMORY.md")).toBeTruthy();
  });

  test("a project with no memory says so in both groups", async () => {
    files = [];
    renderMemory();
    await screen.findByTestId("memory-index-empty");
    expect(screen.getByTestId("memory-topics-empty")).toBeTruthy();
    expect(screen.queryAllByTestId("memory-file")).toHaveLength(0);
  });

  test("a memory list that cannot be loaded says why", async () => {
    api.restore();
    api = mockApi(() => Response.json({ error: "Database is locked" }, { status: 500 }));
    renderMemory();
    expect((await screen.findByTestId("memory-load-error")).textContent).toBe("Database is locked");
  });
});

describe("telling Claude what to change or remove", () => {
  const request = (text: string) => {
    type("memory-request-input", text);
    fireEvent.click(screen.getByTestId("memory-request-send"));
  };
  const status = () => screen.getByTestId("memory-request-status").textContent;
  const reply = (text: string, extra: Partial<Message> = {}): Message =>
    ({
      id: "msg_reply",
      projectId: "p1",
      threadId: null,
      role: "assistant",
      blocks: [{ type: "text", text }],
      inReplyTo: "msg_req",
      createdAt: AT,
      ...extra,
    }) as Message;

  beforeEach(() => {
    respond = (method, path, body) =>
      method === "POST" && path === "/projects/p1/memory/requests"
        ? Response.json(
            { message: { ...userMessage, id: "msg_req", text: (body as { text: string }).text } },
            { status: 201 },
          )
        : undefined;
  });

  test("sends the words to the coordinator, waits for its reply, then shows it and reloads the list", async () => {
    renderMemory();
    await screen.findAllByTestId("memory-file");
    expect((screen.getByTestId("memory-request-send") as HTMLButtonElement).disabled).toBe(true);

    request("Forget the Friday freeze");

    await waitFor(() =>
      expect(screen.getByTestId("memory-request").getAttribute("data-phase")).toBe("working"),
    );
    expect(memoryWrites()).toEqual([
      {
        method: "POST",
        path: "/projects/p1/memory/requests",
        body: { text: "Forget the Friday freeze" },
      },
    ]);
    expect((screen.getByTestId("memory-request-input") as HTMLInputElement).value).toBe("");
    expect(status()).toContain("Claude is updating memory");
    expect((screen.getByTestId("memory-request-send") as HTMLButtonElement).disabled).toBe(true);

    // Another message on the stream is not the answer.
    await announce(reply("Something else", { id: "msg_other", inReplyTo: "msg_elsewhere" }));
    expect(screen.getByTestId("memory-request").getAttribute("data-phase")).toBe("working");

    files = [{ ...index, body: "- Deploys go out on Tuesdays", updatedAt: AT }];
    await announce(reply("Updated MEMORY.md and deleted testing.md."));

    expect(screen.getByTestId("memory-request").getAttribute("data-phase")).toBe("answered");
    expect(status()).toBe("Updated MEMORY.md and deleted testing.md.");
    await waitFor(() => expect(fileRow("testing.md")).toBeUndefined());
    expect(
      within(fileRow("MEMORY.md") as HTMLElement)
        .getByTestId("memory-file-updated")
        .getAttribute("datetime"),
    ).toBe(AT);
  });

  test("a failed turn says so in the reply's words", async () => {
    renderMemory();
    await screen.findAllByTestId("memory-file");
    request("Drop the stale notes");
    await waitFor(() =>
      expect(screen.getByTestId("memory-request").getAttribute("data-phase")).toBe("working"),
    );

    await announce(reply("The model is overloaded.", { failed: true }));

    expect(status()).toBe("The model is overloaded.");
  });

  test("a refused request keeps the words and says why", async () => {
    respond = () => Response.json({ error: "The project is paused" }, { status: 409 });
    renderMemory();
    await screen.findAllByTestId("memory-file");

    request("Forget the freeze");

    await waitFor(() => expect(status()).toBe("The project is paused"));
    expect(screen.getByTestId("memory-request-status").getAttribute("role")).toBe("alert");
    expect((screen.getByTestId("memory-request-input") as HTMLInputElement).value).toBe(
      "Forget the freeze",
    );
  });
});

describe("a file that changes on the host", () => {
  test("an open file shows the newer copy when the person has no edits", async () => {
    renderMemory();
    await openFile("MEMORY.md");
    files = [
      { ...index, body: "- written by the coordinator", updatedAt: "2026-09-30T11:00:00.000Z" },
      testing,
    ];

    await announce(userMessage);

    await waitFor(() =>
      expect((screen.getByTestId("memory-body") as HTMLTextAreaElement).value).toBe(
        "- written by the coordinator",
      ),
    );
    expect(screen.queryByTestId("memory-changed-notice")).toBeNull();
  });

  test("keeps the person's edits and offers the newer copy instead", async () => {
    renderMemory();
    await openFile("MEMORY.md");
    type("memory-body", "my edit");
    files = [
      { ...index, body: "- written by the coordinator", updatedAt: "2026-09-30T11:00:00.000Z" },
      testing,
    ];

    await announce(userMessage);

    await screen.findByTestId("memory-changed-notice");
    expect((screen.getByTestId("memory-body") as HTMLTextAreaElement).value).toBe("my edit");

    fireEvent.click(screen.getByTestId("memory-load-newer"));
    expect((screen.getByTestId("memory-body") as HTMLTextAreaElement).value).toBe(
      "- written by the coordinator",
    );
    expect(screen.queryByTestId("memory-changed-notice")).toBeNull();
  });
});
