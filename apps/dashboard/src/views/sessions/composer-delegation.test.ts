import { describe, expect, mock, test } from "bun:test";
import {
  caretAfterArmedDelegation,
  formatDelegationArmedSummary,
  handleDelegationSuggestionKey,
  isContinuousDraftEdit,
  normalizeDelegationSelection,
  resolveArmedDelegationHighlight,
  withDelegationHighlightTokens,
} from "./composer-delegation";
import type { RuntimeDelegationCandidate } from "./typeahead";

const candidate = (
  overrides: Partial<RuntimeDelegationCandidate> = {},
): RuntimeDelegationCandidate => ({
  id: "codex",
  label: "Codex",
  text: "codex",
  start: 0,
  end: 5,
  ...overrides,
});

describe("isContinuousDraftEdit", () => {
  test("treats append and backspace as the same draft", () => {
    expect(isContinuousDraftEdit("codex fix", "codex fix please")).toBe(true);
    expect(isContinuousDraftEdit("codex fix please", "codex fix")).toBe(true);
    expect(isContinuousDraftEdit("codex", "codex")).toBe(true);
  });

  test("treats a non-prefix replacement as a new draft", () => {
    expect(isContinuousDraftEdit("codex fix the build", "codex please rewrite auth")).toBe(false);
    expect(isContinuousDraftEdit("codex help", "claude help")).toBe(false);
    expect(isContinuousDraftEdit("codex help", "please codex help")).toBe(false);
  });
});

describe("handleDelegationSuggestionKey", () => {
  test("Escape dismisses the offer chip", () => {
    const onArm = mock((_selection: unknown) => {});
    const onDismiss = mock(() => {});
    const event = {
      key: "Escape",
      preventDefault: mock(() => {}),
    } as unknown as Parameters<typeof handleDelegationSuggestionKey>[0]["event"];

    expect(
      handleDelegationSuggestionKey({
        event,
        suggestion: candidate(),
        onArm,
        onDismiss,
      }),
    ).toBe("dismissed");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
    expect(onArm).not.toHaveBeenCalled();
  });

  test("Tab no longer arms from the keyboard", () => {
    const onArm = mock((_selection: unknown) => {});
    const onDismiss = mock(() => {});
    const event = {
      key: "Tab",
      preventDefault: mock(() => {}),
    } as unknown as Parameters<typeof handleDelegationSuggestionKey>[0]["event"];

    expect(
      handleDelegationSuggestionKey({
        event,
        suggestion: candidate(),
        onArm,
        onDismiss,
      }),
    ).toBe("none");
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onArm).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test("returns none when there is no suggestion", () => {
    expect(
      handleDelegationSuggestionKey({
        event: { key: "Escape", preventDefault: mock(() => {}) } as never,
        suggestion: null,
        onArm: mock(() => {}),
        onDismiss: mock(() => {}),
      }),
    ).toBe("none");
  });
});

describe("normalizeDelegationSelection", () => {
  test("clears Fast mode when the model does not support it", () => {
    expect(
      normalizeDelegationSelection({
        id: "claude",
        model: "claude-opus-4-8",
        reasoning: "medium",
        fastMode: true,
      }).fastMode,
    ).toBe(false);
  });

  test("keeps Fast mode for codex", () => {
    expect(
      normalizeDelegationSelection({
        id: "codex",
        model: "gpt-5.5",
        reasoning: "medium",
        fastMode: true,
      }).fastMode,
    ).toBe(true);
  });

  test("preserves the armed token range while normalizing", () => {
    expect(
      normalizeDelegationSelection({
        id: "codex",
        model: "gpt-5.5",
        reasoning: "medium",
        fastMode: false,
        tokenStart: 12,
        tokenEnd: 17,
      }),
    ).toMatchObject({ tokenStart: 12, tokenEnd: 17 });
  });
});

describe("resolveArmedDelegationHighlight", () => {
  test("does not highlight an explicitly armed runtime in the editable draft", () => {
    const draft = "use codex first then codex again";
    const first = resolveArmedDelegationHighlight(draft, {
      id: "codex",
      model: "gpt-5.5",
      reasoning: "medium",
      tokenStart: 4,
      tokenEnd: 9,
    });
    expect(first).toBeNull();

    const second = resolveArmedDelegationHighlight(draft, {
      id: "codex",
      model: "gpt-5.5",
      reasoning: "medium",
      tokenStart: 21,
      tokenEnd: 26,
    });
    expect(second).toBeNull();
  });

  test("does not scan for another runtime occurrence when the stored range is stale", () => {
    const draft = "please use codex now";
    expect(
      resolveArmedDelegationHighlight(draft, {
        id: "codex",
        model: "gpt-5.5",
        reasoning: "medium",
        tokenStart: 0,
        tokenEnd: 5,
      }),
    ).toBeNull();
  });
});

describe("caretAfterArmedDelegation", () => {
  test("places the caret immediately after the armed runtime word", () => {
    expect(
      caretAfterArmedDelegation("codex", {
        id: "codex",
        model: "gpt-5.5",
        reasoning: "medium",
        tokenStart: 0,
        tokenEnd: 5,
      }),
    ).toBe(5);

    expect(
      caretAfterArmedDelegation("send to codex", {
        id: "codex",
        model: "gpt-5.5",
        reasoning: "medium",
        tokenStart: 8,
        tokenEnd: 13,
      }),
    ).toBe(13);
  });
});

describe("withDelegationHighlightTokens", () => {
  test("does not inject runtime highlight marks into the draft", () => {
    const tokens = withDelegationHighlightTokens(
      [
        {
          kind: "worker",
          start: 0,
          end: 4,
          id: "w1",
          label: "Ada",
        },
        {
          kind: "control",
          start: 5,
          end: 20,
          id: "CX_BROWSER_USE",
          label: "CX_BROWSER_USE",
        },
      ],
      {
        suggestion: candidate(),
        selection: {
          id: "claude",
          model: "claude-opus-4-8",
          reasoning: "medium",
          tokenStart: 0,
          tokenEnd: 6,
        },
        draft: "claude please compare with claude again",
      },
    );
    expect(tokens).toEqual([
      {
        kind: "worker",
        start: 0,
        end: 4,
        id: "w1",
        label: "Ada",
      },
    ]);
  });
});

describe("formatDelegationArmedSummary", () => {
  test("summarizes runtime, model, thinking, and fast mode", () => {
    expect(
      formatDelegationArmedSummary({
        id: "codex",
        model: "gpt-5.5",
        reasoning: "high",
        fastMode: true,
      }),
    ).toContain("Will delegate to ‘Codex’");
    expect(
      formatDelegationArmedSummary({
        id: "codex",
        model: "gpt-5.5",
        reasoning: "high",
        fastMode: true,
      }),
    ).toContain("fast mode");
  });
});
