import { describe, expect, mock, test } from "bun:test";
import type { KeyboardEvent } from "react";
import { handleTypeaheadKeys } from "./composer-typeahead";
import type { TypeaheadItem } from "./typeahead";

const item: TypeaheadItem = {
  id: "worker",
  label: "Worker",
  kind: "worker",
  insertText: "%Worker ",
};

const event = (key: string) =>
  ({ key, preventDefault: mock(() => {}) }) as unknown as KeyboardEvent<HTMLTextAreaElement>;

describe("handleTypeaheadKeys", () => {
  test("does not apply an untouched suggestion when Enter is pressed", () => {
    const applyTypeahead = mock(() => {});
    expect(
      handleTypeaheadKeys({
        event: event("Enter"),
        typeaheadItems: [item],
        typeaheadIndex: -1,
        setTypeaheadIndex: () => {},
        applyTypeahead,
        dismiss: () => {},
      }),
    ).toBe(false);
    expect(applyTypeahead).not.toHaveBeenCalled();
  });

  test("applies only after explicit arrow navigation", () => {
    let index = -1;
    const applyTypeahead = mock(() => {});
    handleTypeaheadKeys({
      event: event("ArrowDown"),
      typeaheadItems: [item],
      typeaheadIndex: index,
      setTypeaheadIndex: (update) => (index = update(index)),
      applyTypeahead,
      dismiss: () => {},
    });
    handleTypeaheadKeys({
      event: event("Enter"),
      typeaheadItems: [item],
      typeaheadIndex: index,
      setTypeaheadIndex: () => {},
      applyTypeahead,
      dismiss: () => {},
    });
    expect(applyTypeahead).toHaveBeenCalledWith(item);
  });

  test("Escape delegates persistent dismissal", () => {
    const dismiss = mock(() => {});
    expect(
      handleTypeaheadKeys({
        event: event("Escape"),
        typeaheadItems: [item],
        typeaheadIndex: -1,
        setTypeaheadIndex: () => {},
        applyTypeahead: () => {},
        dismiss,
      }),
    ).toBe(true);
    expect(dismiss).toHaveBeenCalled();
  });
});
