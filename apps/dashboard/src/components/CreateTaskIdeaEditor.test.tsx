import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { CreateTaskIdeaEditor } = await import("./CreateTaskIdeaEditor");

afterEach(() => {
  cleanup();
});

describe("CreateTaskIdeaEditor", () => {
  test("switches to markdown preview tab", () => {
    render(
      <CreateTaskIdeaEditor value="# Hello" onChange={() => undefined} onError={() => undefined} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Markdown" }));
    expect(screen.getByText("Preview")).toBeDefined();
  });

  test("imports markdown file content", async () => {
    const onChange = mock(() => undefined);
    const { container } = render(
      <CreateTaskIdeaEditor value="" onChange={onChange} onError={() => undefined} />,
    );

    const input = container.querySelector('input[aria-label="Import Markdown file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("markdown import input not found");
    }

    const file = new File(["# Imported"], "notes.md", { type: "text/markdown" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("# Imported"));
  });
});
