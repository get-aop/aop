import { afterEach, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { getSessionComposerDraft, updateSessionComposerDraft } from "./session-composer-drafts";

setupDashboardDom();

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { useSessionComposer } = await import("./use-session-composer");

afterEach(cleanup);

test("an empty draft immediately replaces previously stored text", () => {
  updateSessionComposerDraft("session", (draft) => ({ ...draft, input: "old text" }));
  updateSessionComposerDraft("session", (draft) => ({ ...draft, input: "" }));
  expect(getSessionComposerDraft("session").input).toBe("");
});

test("new session drafts start with empty structured orchestration state", () => {
  expect(getSessionComposerDraft("structured-empty")).toMatchObject({
    runtimeActions: [],
    workflowSelection: null,
  });
});

test("useSessionComposer restores each session's draft when switching sessions", () => {
  const input = (id: string) => ({
    active: { id } as never,
    typing: false,
    setTyping: mock(() => {}),
    setStreamProgress: mock(() => {}),
    setDetail: mock(() => {}),
    setMidRunHints: mock(() => {}),
    showToast: mock(() => {}),
    refreshList: mock(async () => {}),
  });
  const { result, rerender } = renderHook(({ id }) => useSessionComposer(input(id)), {
    initialProps: { id: "draft-a" },
  });

  act(() => result.current.setInput("alpha"));
  rerender({ id: "draft-b" });
  act(() => result.current.setInput("beta"));
  rerender({ id: "draft-a" });

  expect(result.current.input).toBe("alpha");
});
