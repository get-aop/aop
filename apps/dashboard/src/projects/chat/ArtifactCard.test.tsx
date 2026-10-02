import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { MessageBlock } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { ChatProvider } = await import("./chat-context");
const { MessageBlocks } = await import("./MessageBlocks");
const { ChatMarkdown } = await import("./ChatMarkdown");
const { ChatOriginContext } = await import("./artifact-links");
const { MessageMeta } = await import("./MessageMeta");
const { resetVisualizeJobs } = await import("../artifact-view/visualize/visualize-store");

beforeEach(() => {
  window.history.pushState({}, "", "/projects/prj_1/threads/thr_1");
  resetVisualizeJobs();
});
afterEach(cleanup);

const inChat = (node: React.ReactNode, threadId: string | null = null) => (
  <ChatProvider projectId="prj_1" projectActive threads={[]} threadsLoaded threadsError={null}>
    <ChatOriginContext.Provider value={{ threadId }}>{node}</ChatOriginContext.Provider>
  </ChatProvider>
);

const blocks: MessageBlock[] = [
  { type: "text", text: "Making the plan." },
  { type: "tool", id: "toolu_1", name: "mcp aop aop artifact create", detail: null, status: "done" },
  { type: "tool", id: "toolu_2", name: "Bash", detail: "ls", status: "done" },
  {
    type: "artifact",
    toolId: "toolu_1",
    artifactId: "lib_1",
    version: 2,
    title: "Release plan",
    kind: "markdown",
    action: "updated",
  },
];

describe("an artifact in the conversation", () => {
  test("is a card with its icon, title, kind and version, in place of the call that made it", () => {
    render(inChat(<MessageBlocks messageId="m1" blocks={blocks} />));

    const card = screen.getByTestId("artifact-card");
    expect(screen.getByTestId("artifact-card-title").textContent).toBe("Release plan");
    expect(screen.getByTestId("artifact-card-meta").textContent).toBe("Document · v2 · updated");
    expect(card.getAttribute("data-artifact-id")).toBe("lib_1");
    // The artifact tool's own row is gone; the other call stays.
    const calls = screen.getAllByTestId("tool-call").map((call) => call.textContent);
    expect(calls.join()).toContain("Bash");
    expect(calls.join()).not.toContain("artifact create");
  });

  test("opens that version where the chat is, beside the thread that is open", () => {
    render(inChat(<MessageBlocks messageId="m1" blocks={blocks} />));
    fireEvent.click(screen.getByTestId("artifact-card"));
    expect(window.location.pathname).toBe("/projects/prj_1/threads/thr_1/artifacts/lib_1/2");
  });

  test("an artifact: link in prose is a pill that opens it", () => {
    render(inChat(<ChatMarkdown content="See [the plan](artifact:lib_9) now." />));
    const pill = screen.getByTestId("artifact-chip");
    expect(pill.textContent).toBe("the plan");
    fireEvent.click(pill);
    expect(window.location.pathname).toBe("/projects/prj_1/threads/thr_1/artifacts/lib_9");
  });

  test("a path in a thread's reply opens that thread's workspace file", () => {
    render(inChat(<ChatMarkdown content="Read [the plan](docs/plan.md)." />, "thr_1"));
    const link = screen.getByTestId("chat-file-link");
    expect(link.getAttribute("data-path")).toBe("docs/plan.md");
    fireEvent.click(link);
    expect(window.location.pathname).toBe("/projects/prj_1/threads/thr_1/files/thr_1/docs%2Fplan.md");
  });
});

describe("Visualize under a reply", () => {
  test("starts a diagram of the reply and opens the view that shows it", async () => {
    const original = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      fetched.push(String(input));
      return new Response(JSON.stringify({ artifact: null }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      render(
        <MessageMeta
          timestamp={new Date().toISOString()}
          copyText="reply"
          visualize={{ projectId: "prj_1", messageId: "smsg_1" }}
        />,
      );
      fireEvent.click(screen.getByTestId("message-visualize"));
      expect(window.location.pathname).toBe("/projects/prj_1/threads/thr_1/visualize/smsg_1");
      // It first asks whether this reply was drawn before.
      expect(fetched[0]).toEndWith("/api/projects/prj_1/visualize/smsg_1");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("is offered only where the row asks for it", () => {
    render(<MessageMeta timestamp={new Date().toISOString()} copyText="mine" align="end" />);
    expect(screen.queryByTestId("message-visualize")).toBeNull();
  });
});
