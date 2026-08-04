import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { closeAttachRepoDialog, openAttachRepoDialog, resetDialogs } from "../shell/dialog-store";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { AttachRepoDialog } = await import("./AttachRepoDialog");

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
  ) as unknown as typeof globalThis.fetch;
  resetDialogs();
  localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  closeAttachRepoDialog();
});

describe("AttachRepoDialog", () => {
  test("lists directories and enables attach only on a git repo", async () => {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fixture API with two directory shapes
    globalThis.fetch = mock((input) => {
      const url = String(input);
      if (url.includes("/fs/directories")) {
        const path = new URL(url, "http://x").searchParams.get("path") ?? "";
        if (path === "/repos/aop-mono") {
          return Promise.resolve(
            new Response(
              JSON.stringify({ path, directories: [], parent: "/repos", isGitRepo: true }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              path: path || "/repos",
              directories: ["aop-mono", "plain"],
              parent: path ? "/" : null,
              isGitRepo: false,
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as unknown as typeof globalThis.fetch;

    const onAttached = mock(() => {});

    render(<AttachRepoDialog onAttached={onAttached} />);
    openAttachRepoDialog();

    const confirm = await screen.findByTestId("attach-repo-confirm");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    // Descend into the git repo.
    fireEvent.click(screen.getByText("aop-mono"));
    await waitFor(() => expect(screen.getByTestId("attach-repo-git-badge")).toBeTruthy());
    expect((screen.getByTestId("attach-repo-confirm") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId("attach-repo-confirm"));
    await waitFor(() => expect(onAttached).toHaveBeenCalled());
  });
});
