import { type KeyboardEvent, useEffect, useRef, useState } from "react";

interface PathFieldProps {
  value: string;
  onType: (value: string) => void;
  onEnter: () => void;
  /** Completes the folder picked out in the list; true when it did, so the key is not also a focus move. */
  onComplete: () => boolean;
  onMove: (step: 1 | -1) => void;
  /** The field lost focus: whatever was typed and not entered is dropped. */
  onLeave: () => void;
}

/**
 * The path at the top of the Attach dialog. Focused, it is a text box that shows the whole path
 * and scrolls inside itself. Unfocused, it shows the path cut from the start, so the end (the
 * folder the person is in) stays in view at any length, and the full path is its tooltip.
 */
export const PathField = ({
  value,
  onType,
  onEnter,
  onComplete,
  onMove,
  onLeave,
}: PathFieldProps) => {
  // A person opens this dialog to choose a folder, so the field starts ready to type into.
  const [editing, setEditing] = useState(true);

  if (!editing) {
    return (
      <button
        type="button"
        data-testid="attach-repo-path"
        title={value}
        aria-label={`Path ${value}`}
        onFocus={() => setEditing(true)}
        className="min-w-0 flex-1 cursor-text text-left"
      >
        {/* The box reads right to left so that the clipped part, and the ellipsis, are at the start. */}
        <span dir="rtl" className="block truncate text-left">
          <bdi dir="ltr">{value}</bdi>
        </span>
      </button>
    );
  }

  return (
    <EditablePath
      value={value}
      onType={onType}
      onEnter={onEnter}
      onComplete={onComplete}
      onMove={onMove}
      onBlur={() => {
        setEditing(false);
        onLeave();
      }}
    />
  );
};

const EditablePath = ({
  value,
  onType,
  onEnter,
  onComplete,
  onMove,
  onBlur,
}: Omit<PathFieldProps, "onLeave"> & { onBlur: () => void }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (handlePathKey(event, { onEnter, onComplete, onMove })) event.preventDefault();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      data-testid="attach-repo-path-input"
      aria-label="Path"
      value={value}
      spellCheck={false}
      autoCapitalize="none"
      autoComplete="off"
      autoCorrect="off"
      onChange={(event) => onType(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-text outline-none"
    />
  );
};

/** What the keys of the path field do; true when one did it, so the browser does not also. */
const handlePathKey = (
  event: KeyboardEvent<HTMLInputElement>,
  actions: Pick<PathFieldProps, "onEnter" | "onComplete" | "onMove">,
): boolean => {
  switch (event.key) {
    case "Enter":
      actions.onEnter();
      return true;
    case "ArrowDown":
      actions.onMove(1);
      return true;
    case "ArrowUp":
      actions.onMove(-1);
      return true;
    case "Tab":
      return !event.shiftKey && actions.onComplete();
    case "ArrowRight":
      return caretIsAtEnd(event.currentTarget) && actions.onComplete();
    default:
      return false;
  }
};

const caretIsAtEnd = (input: HTMLInputElement): boolean =>
  input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
