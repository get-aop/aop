import { describe, expect, mock, test } from "bun:test";
import type { KeyboardEvent } from "react";
import {
  handleComposerKeyPipeline,
  handleComposerSendKey,
  isComposerComposing,
} from "./composer-keyboard";

const keyEvent = (
  key: string,
  options: { shiftKey?: boolean; isComposing?: boolean } = {},
): KeyboardEvent<HTMLTextAreaElement> =>
  ({
    key,
    shiftKey: options.shiftKey ?? false,
    preventDefault: mock(() => {}),
    nativeEvent: { isComposing: options.isComposing ?? false },
  }) as unknown as KeyboardEvent<HTMLTextAreaElement>;

describe("composer keyboard composition guards", () => {
  test("detects IME composition via nativeEvent and Process key", () => {
    expect(isComposerComposing(keyEvent("Enter", { isComposing: true }))).toBe(true);
    expect(isComposerComposing(keyEvent("Process"))).toBe(true);
    expect(isComposerComposing(keyEvent("Enter"))).toBe(false);
  });

  test("does not send while composing", () => {
    const onSend = mock(() => {});
    handleComposerSendKey(keyEvent("Enter", { isComposing: true }), true, onSend);
    expect(onSend).not.toHaveBeenCalled();

    handleComposerSendKey(keyEvent("Enter"), true, onSend);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test("pipeline ignores keys during composition so Enter can commit the glyph", () => {
    const onSend = mock(() => {});
    const applyTypeahead = mock(() => {});
    handleComposerKeyPipeline({
      event: keyEvent("Enter", { isComposing: true }),
      input: "café",
      caret: 4,
      slashIndex: 0,
      setSlashIndex: () => {},
      applySlashPick: () => {},
      slashTokenKey: null,
      setDismissedSlashKey: () => {},
      typeaheadItems: [{ id: "w", label: "Worker", kind: "worker", insertText: "%Worker " }],
      typeaheadIndex: 0,
      setTypeaheadIndex: () => 0,
      applyTypeahead,
      typeaheadKey: "worker:0",
      setDismissedTypeahead: () => {},
      delegationSuggestion: null,
      onRuntimeDelegationChange: undefined,
      dismissDelegation: () => {},
      canSend: true,
      onSend,
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(applyTypeahead).not.toHaveBeenCalled();
  });
});
