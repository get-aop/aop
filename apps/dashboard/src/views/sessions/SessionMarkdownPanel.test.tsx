import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const loadRequests = new Map<string, (content: string) => void>();
const actualClient = await import("../../api/client");
const getMarkdownFile = mock(
  (path: string) =>
    new Promise<{ path: string; content: string; exists: boolean }>((resolve) => {
      loadRequests.set(path, (content) => resolve({ path, content, exists: true }));
    }),
);
const saveMarkdownFile = mock(async (path: string, content: string) => ({
  path,
  content,
  exists: true,
}));

mock.module("../../api/client", () => ({
  ...actualClient,
  getMarkdownFile,
  saveMarkdownFile,
}));

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { SessionMarkdownPanel } = await import("./SessionMarkdownPanel");
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");

afterEach(() => {
  cleanup();
  getMarkdownFile.mockClear();
  saveMarkdownFile.mockClear();
  loadRequests.clear();
  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    Reflect.deleteProperty(document, "execCommand");
  }
});

describe("SessionMarkdownPanel", () => {
  test("shows three loading bars while the file request is pending", () => {
    render(
      <SessionMarkdownPanel path="/repo/pending.md" onClose={() => {}} showToast={() => {}} />,
    );
    expect(screen.getAllByTestId("markdown-loading-bar")).toHaveLength(3);
  });

  test("shows an in-panel error and retries the request", async () => {
    getMarkdownFile.mockRejectedValueOnce(new Error("Server unavailable"));
    render(<SessionMarkdownPanel path="/repo/error.md" onClose={() => {}} showToast={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Server unavailable");
    getMarkdownFile.mockResolvedValueOnce({
      path: "/repo/error.md",
      content: "Recovered",
      exists: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Recovered")).toBeTruthy();
    expect(getMarkdownFile).toHaveBeenCalledTimes(2);
  });

  test("expands from the header and reflects the supplied width", async () => {
    getMarkdownFile.mockResolvedValueOnce({ path: "/repo/plan.md", content: "Plan", exists: true });
    const onToggleExpand = mock(() => {});
    render(
      <SessionMarkdownPanel
        path="/repo/plan.md"
        width={640}
        onToggleExpand={onToggleExpand}
        onClose={() => {}}
        showToast={() => {}}
      />,
    );
    const panel = screen.getByTestId("session-right-panel");
    expect(panel.getAttribute("style")).toContain("width: 640px");
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(onToggleExpand).toHaveBeenCalled();
  });

  test("keeps the latest file content when an earlier load resolves later", async () => {
    const view = render(
      <SessionMarkdownPanel path="/repo/first.md" onClose={() => {}} showToast={() => {}} />,
    );
    await waitFor(() => expect(getMarkdownFile).toHaveBeenCalledWith("/repo/first.md"));

    view.rerender(
      <SessionMarkdownPanel path="/repo/second.md" onClose={() => {}} showToast={() => {}} />,
    );
    await waitFor(() => expect(getMarkdownFile).toHaveBeenCalledWith("/repo/second.md"));
    expect([...loadRequests.keys()]).toEqual(["/repo/first.md", "/repo/second.md"]);

    await act(async () => {
      loadRequests.get("/repo/second.md")?.("Second file");
      await Promise.resolve();
    });
    await screen.findByText("Second file");
    await act(async () => {
      loadRequests.get("/repo/first.md")?.("Stale first file");
      await Promise.resolve();
    });

    expect(screen.getByText("Second file")).toBeTruthy();
    expect(screen.queryByText("Stale first file")).toBeNull();
  });

  test("renders an empty body when the file is missing", async () => {
    getMarkdownFile.mockImplementation(async (path) => ({ path, content: "", exists: false }));

    render(
      <SessionMarkdownPanel path="/repo/missing.md" onClose={() => {}} showToast={() => {}} />,
    );

    await waitFor(() => expect(getMarkdownFile).toHaveBeenCalledWith("/repo/missing.md"));
    expect(screen.queryByTestId("chat-markdown")).toBeNull();
  });

  test("saves edited content and returns to view mode", async () => {
    getMarkdownFile.mockImplementation(async (path) => ({
      path,
      content: "# Before",
      exists: true,
    }));
    const showToast = mock(() => {});
    render(<SessionMarkdownPanel path="/repo/plan.md" onClose={() => {}} showToast={showToast} />);

    await screen.findByRole("heading", { name: "Before" });
    await act(async () => {
      screen.getByRole("button", { name: /Edit/ }).click();
    });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("# Before");
    fireEvent.change(textarea, { target: { value: "# After" } });

    await act(async () => {
      screen.getByRole("button", { name: /Save/ }).click();
      await Promise.resolve();
    });

    await waitFor(() => expect(saveMarkdownFile).toHaveBeenCalledWith("/repo/plan.md", "# After"));
    expect(showToast).toHaveBeenCalledWith("Saved · plan.md");
    await screen.findByRole("heading", { name: "After" });
  });

  test("supports command-save and confirms Escape before discarding a dirty draft", async () => {
    getMarkdownFile.mockResolvedValueOnce({
      path: "/repo/plan.md",
      content: "Before",
      exists: true,
    });
    render(<SessionMarkdownPanel path="/repo/plan.md" onClose={() => {}} showToast={() => {}} />);
    await screen.findByText("Before");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Dirty" } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.getByRole("alertdialog", { name: "Discard Markdown changes?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(textarea, { key: "s", metaKey: true });
    await waitFor(() => expect(saveMarkdownFile).toHaveBeenCalledWith("/repo/plan.md", "Dirty"));
  });

  test("keeps edit mode and draft content when saving fails", async () => {
    getMarkdownFile.mockImplementation(async (path) => ({
      path,
      content: "# Before",
      exists: true,
    }));
    saveMarkdownFile.mockRejectedValueOnce(new Error("Save failed"));
    const showToast = mock(() => {});
    render(<SessionMarkdownPanel path="/repo/plan.md" onClose={() => {}} showToast={showToast} />);

    await screen.findByRole("heading", { name: "Before" });
    await act(async () => {
      screen.getByRole("button", { name: /Edit/ }).click();
    });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "# Unsaved" } });
    await act(async () => {
      screen.getByRole("button", { name: /Save/ }).click();
      await Promise.resolve();
    });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Save failed"));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("# Unsaved");
    expect(screen.getByRole("button", { name: /Save/ })).toBeTruthy();
  });

  test("copies the absolute path and reports feedback when the clipboard falls back", async () => {
    getMarkdownFile.mockImplementation(async (path) => ({ path, content: "", exists: false }));
    const writeText = mock(async () => {
      throw new Error("Clipboard unavailable");
    });
    const execCommand = mock(() => true);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    const showToast = mock(() => {});
    render(<SessionMarkdownPanel path="/repo/plan.md" onClose={() => {}} showToast={showToast} />);

    await waitFor(() => expect(getMarkdownFile).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(writeText).toHaveBeenCalledWith("/repo/plan.md");
    expect(showToast).toHaveBeenCalledWith("Path copied");
  });
});
