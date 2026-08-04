import { afterEach, describe, expect, test } from "bun:test";
import type { ChatSessionMessage } from "../../api/client";
import { setupDashboardDom } from "../../test/setup-dom";
import { ChatStreamActivity } from "./ChatStreamActivity";
import { ChatThread } from "./ChatThread";
import { parseMessageSegments } from "./sessions-runtime";
import { chatThreadProps } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
  document.querySelector("[data-chat-thread-test-style]")?.remove();
});

const labeledMessages = (count: number, sessionId = "s1"): ChatSessionMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `msg-${index + 1}`,
    sessionId,
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `Message label ${index + 1}`,
    action: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  }));

describe("ChatThread user messages", () => {
  test("highlights command and mention segments", () => {
    expect(
      parseMessageSegments("codex please ship this").every((segment) => segment.kind === "text"),
    ).toBe(true);
    expect(
      parseMessageSegments("/task create Fix it %K6", ["K6"]).map((segment) => segment.kind),
    ).toEqual(["command", "text", "mention"]);

    render(
      <ChatThread
        {...chatThreadProps({
          messages: [
            {
              id: "segmented-user-message",
              sessionId: "s1",
              role: "user",
              content: "/task create Fix it %K6",
              action: null,
              createdAt: "2026-07-18T12:00:00.000Z",
            },
          ],
          workerNames: ["K6"],
          workerColors: { k6: "var(--color-favorite)" },
        })}
      />,
    );

    expect(screen.getByText("/task create")).toBeTruthy();
    const mention = screen.getByText("%K6");
    expect(mention).toBeTruthy();
    expect(mention.className).toContain("text-xs");
  });

  test("preserves composer wrapping and indentation after sending", async () => {
    const style = document.createElement("style");
    style.dataset.chatThreadTestStyle = "true";
    style.textContent = await Bun.file(new URL("../../index.css", import.meta.url)).text();
    document.head.append(style);
    const content = "First paragraph\n\nSecond paragraph\n\tIndented";
    render(
      <ChatThread
        {...chatThreadProps({
          messages: [
            {
              id: "multiline-user-message",
              sessionId: "s1",
              role: "user",
              content,
              action: null,
              createdAt: "2026-07-18T12:00:00.000Z",
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("First paragraph")).toBeTruthy();
    const secondParagraph = screen.getByText(/Second paragraph/);
    expect(secondParagraph.textContent).toContain("Indented");
    expect(secondParagraph.closest(".chat-markdown--line-breaks")).not.toBeNull();
  });
});

describe("ChatThread T3Code timeline", () => {
  test("folds completed work while keeping the final answer visible", () => {
    render(
      <ChatThread
        {...chatThreadProps({
          messages: [
            {
              id: "user-1",
              sessionId: "s1",
              role: "user",
              content: "Please inspect this",
              action: null,
              createdAt: "2026-07-18T12:00:00.000Z",
            },
            {
              id: "assistant-1",
              sessionId: "s1",
              role: "assistant",
              content: "The final answer",
              action: null,
              createdAt: "2026-07-18T12:01:00.000Z",
              runStatus: "completed",
              activity: {
                thinking: "Checking the implementation",
                content: "I found the relevant files.",
                commandGroups: [
                  {
                    id: "tools",
                    commands: [
                      { id: "read", command: "Read", detail: "src/chat.tsx", status: "done" },
                      { id: "test", command: "Bash", detail: "bun test", status: "done" },
                    ],
                  },
                ],
              },
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("The final answer")).toBeTruthy();
    expect(screen.queryByText("Checking the implementation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Worked for 1m 0s" }));
    expect(screen.getByText("Checking the implementation")).toBeTruthy();
    expect(screen.getByText("+1 previous tool call")).toBeTruthy();
    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.queryByText("Read")).toBeNull();
    fireEvent.click(screen.getByText("+1 previous tool call"));
    expect(screen.getByText("Read")).toBeTruthy();
  });

  test("attaches the session changed-files slot to the latest assistant turn", () => {
    render(
      <ChatThread
        {...chatThreadProps({
          messages: [
            ...labeledMessages(4),
            {
              id: "queued-user",
              sessionId: "s1",
              role: "user",
              content: "Queued follow-up",
              action: null,
              disposition: "queued",
              createdAt: "2026-07-18T12:02:00.000Z",
            },
          ],
        })}
        assistantFooter={<div data-testid="assistant-footer">Changed files</div>}
      />,
    );

    expect(
      screen.getByTestId("assistant-footer").closest('[data-message-id="msg-4"]'),
    ).not.toBeNull();
    expect(
      screen.getByTestId("assistant-footer").closest('[data-message-id="queued-user"]'),
    ).toBeNull();
  });

  test("highlights minimap turns that intersect the viewport", () => {
    render(<ChatThread {...chatThreadProps({ messages: labeledMessages(4) })} />);
    const thread = screen.getByTestId("chat-thread");
    const userRows = thread.querySelectorAll<HTMLElement>('[data-message-role="user"]');
    thread.getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect;
    const firstRow = userRows[0];
    const secondRow = userRows[1];
    if (!firstRow || !secondRow) throw new Error("Expected two user timeline rows");
    firstRow.getBoundingClientRect = () => ({ top: 10, bottom: 30 }) as DOMRect;
    secondRow.getBoundingClientRect = () => ({ top: 120, bottom: 140 }) as DOMRect;

    fireEvent.scroll(thread);

    const markers = screen.getAllByRole("button", { name: "Jump to message: User message" });
    expect(markers[0]?.className).toContain("w-3 bg-foreground/55");
    expect(markers[1]?.className).toContain("w-2 bg-muted-foreground/25");
  });

  test("collapses long user messages and exposes T3Code message controls", () => {
    const content = Array.from({ length: 10 }, (_, index) => `Line ${index + 1}`).join("\n");
    render(
      <ChatThread
        {...chatThreadProps({
          messages: [
            {
              id: "long-user",
              sessionId: "s1",
              role: "user",
              content,
              action: null,
              createdAt: "2026-07-18T12:00:00.000Z",
            },
          ],
        })}
      />,
    );

    const body = document.querySelector('[data-user-message-collapsed="true"]');
    expect(body).not.toBeNull();
    expect(screen.getByRole("button", { name: "Show full message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(screen.getByText("12:00 PM")).toBeTruthy();
  });
});

describe("ChatThread progressive history", () => {
  test("initially renders only the newest 40 of 81 messages", () => {
    render(
      <ChatThread
        {...chatThreadProps({
          sessionId: "long",
          messages: labeledMessages(81, "long"),
        })}
      />,
    );

    expect(screen.getByText("Message label 81")).toBeTruthy();
    expect(screen.getByText("Message label 42")).toBeTruthy();
    expect(screen.queryByText("Message label 41")).toBeNull();
    expect(screen.getByTestId("load-earlier-chat-messages")).toBeTruthy();
  });

  test("loads earlier batches and finally the oldest message", () => {
    render(
      <ChatThread
        {...chatThreadProps({
          sessionId: "long",
          messages: labeledMessages(81, "long"),
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("load-earlier-chat-messages"));
    expect(screen.getByText("Message label 2")).toBeTruthy();
    expect(screen.queryByText("Message label 1")).toBeNull();

    fireEvent.click(screen.getByTestId("load-earlier-chat-messages"));
    expect(screen.getByText("Message label 1")).toBeTruthy();
    expect(screen.queryByTestId("load-earlier-chat-messages")).toBeNull();
  });

  test("keeps the visible window bounded when messages append to a long session", () => {
    const initial = labeledMessages(50, "long");
    const { rerender } = render(
      <ChatThread {...chatThreadProps({ sessionId: "long", messages: initial })} />,
    );

    expect(screen.getByText("Message label 50")).toBeTruthy();
    expect(screen.queryByText("Message label 10")).toBeNull();

    const appended = [
      ...initial,
      {
        id: "msg-51",
        sessionId: "long",
        role: "user" as const,
        content: "Message label 51",
        action: null,
        createdAt: new Date().toISOString(),
      },
    ];
    rerender(<ChatThread {...chatThreadProps({ sessionId: "long", messages: appended })} />);

    expect(screen.getByText("Message label 51")).toBeTruthy();
    // History limit stays at 40; oldest of the previous window drops out.
    expect(screen.queryByText("Message label 11")).toBeNull();
    expect(screen.getByText("Message label 12")).toBeTruthy();
  });

  test("resets the history window when switching sessions", () => {
    const { rerender } = render(
      <ChatThread
        {...chatThreadProps({
          sessionId: "a",
          messages: labeledMessages(60, "a"),
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("load-earlier-chat-messages"));
    expect(screen.getByText("Message label 1")).toBeTruthy();

    rerender(
      <ChatThread
        {...chatThreadProps({
          sessionId: "b",
          messages: labeledMessages(60, "b"),
        })}
      />,
    );

    expect(screen.getByText("Message label 60")).toBeTruthy();
    expect(screen.queryByText("Message label 1")).toBeNull();
    expect(screen.getByTestId("load-earlier-chat-messages")).toBeTruthy();
  });
});

describe("ChatStreamActivity live vs completed rendering", () => {
  test("renders live answer text as plain pre-wrap and completed content as markdown", async () => {
    const style = document.createElement("style");
    style.dataset.chatThreadTestStyle = "true";
    style.textContent = await Bun.file(new URL("../../index.css", import.meta.url)).text();
    document.head.append(style);

    const { rerender } = render(
      <ChatStreamActivity
        thinking=""
        content={"**bold** and plain"}
        commandGroups={[]}
        typing={true}
      />,
    );

    const live = screen.getByTestId("assistant-stream-content").firstElementChild as HTMLElement;
    expect(live.textContent).toBe("**bold** and plain");
    expect(getComputedStyle(live).whiteSpace).toBe("pre-wrap");

    await act(async () => {
      rerender(
        <ChatStreamActivity
          thinking=""
          content={"**bold** and plain"}
          commandGroups={[]}
          typing={false}
        />,
      );
    });

    const completed = screen.getByTestId("assistant-stream-content");
    await waitFor(() =>
      expect(completed.querySelector('[data-streamdown="strong"]')?.textContent).toBe("bold"),
    );
    expect(completed.textContent).toContain("and plain");
  });
});

describe("chat thread + delegation rail layout CSS", () => {
  test("floating delegation cards never shift the centered chat column", async () => {
    const css = await Bun.file(new URL("../../index.css", import.meta.url)).text();
    const base = css.match(/\.chat-column,[\s\S]*?\.chat-thread-content\s*\{[^}]+\}/)?.[0] ?? "";

    expect(base).toContain("margin-left: auto");
    expect(base).toContain("margin-right: auto");
    expect(css).not.toContain("--chat-delegation-rail");
    expect(css).not.toContain("chat-column--with-delegations");
    expect(css).not.toContain("chat-thread-content--with-delegations");
  });
});
