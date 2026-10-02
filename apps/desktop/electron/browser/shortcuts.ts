import type { BrowserShortcut } from "@aop/common";

/** The part of Electron's `Input` (from `before-input-event`) a shortcut is read from. */
export interface KeyInput {
  type: string;
  code: string;
  key: string;
  shift: boolean;
  control: boolean;
  alt: boolean;
  meta: boolean;
  isAutoRepeat?: boolean;
}

/**
 * The browser shortcut a key press is, or null. ⌘ on a Mac and Ctrl elsewhere, as in Chrome:
 * ⌘L, ⌘R (⇧ to skip the cache), ⌘[ and ⌘], ⌥⌘I or F12, ⌘T and ⌘W, ⌃Tab, ⌘= ⌘- ⌘0, and ⌘⇧B
 * to show or hide the browser. Read from the physical key (`code`), so a keyboard layout that
 * types another letter there still has the same shortcut, like the app's menus.
 */
export const browserShortcutFor = (
  input: KeyInput,
  platform: NodeJS.Platform,
): BrowserShortcut | null => {
  if (input.type !== "keyDown" || input.isAutoRepeat) return null;
  const table = platform === "darwin" ? MAC_SHORTCUTS : OTHER_SHORTCUTS;
  return table.get(chordOf(input)) ?? null;
};

/** Shortcuts the app's own window hands to the browser while it is shown (not zoom: that is AOP's). */
export const WINDOW_BROWSER_SHORTCUTS: ReadonlySet<BrowserShortcut> = new Set([
  "focus-address",
  "reload",
  "hard-reload",
  "back",
  "forward",
  "devtools",
  "new-tab",
  "close-tab",
  "next-tab",
  "previous-tab",
]);

// The same keys on every platform, after ⌘ (Mac) or Ctrl (elsewhere).
const COMMAND_KEYS: [string, BrowserShortcut][] = [
  ["KeyL", "focus-address"],
  ["KeyR", "reload"],
  ["shift+KeyR", "hard-reload"],
  ["BracketLeft", "back"],
  ["BracketRight", "forward"],
  ["KeyT", "new-tab"],
  ["KeyW", "close-tab"],
  ["Equal", "zoom-in"],
  // ⌘= is typed with ⇧ on many layouts (it is the + key).
  ["shift+Equal", "zoom-in"],
  ["NumpadAdd", "zoom-in"],
  ["Minus", "zoom-out"],
  ["NumpadSubtract", "zoom-out"],
  ["Digit0", "zoom-reset"],
  ["Numpad0", "zoom-reset"],
  ["shift+KeyB", "toggle-browser"],
];

const BOTH_PLATFORMS: [string, BrowserShortcut][] = [
  ["F12", "devtools"],
  ["ctrl+Tab", "next-tab"],
  ["ctrl+shift+Tab", "previous-tab"],
];

const MAC_SHORTCUTS = new Map<string, BrowserShortcut>([
  ...BOTH_PLATFORMS,
  ...COMMAND_KEYS.map(([chord, shortcut]): [string, BrowserShortcut] => [
    `meta+${chord}`,
    shortcut,
  ]),
  ["meta+alt+KeyI", "devtools"],
  ["meta+shift+BracketLeft", "previous-tab"],
  ["meta+shift+BracketRight", "next-tab"],
]);

const OTHER_SHORTCUTS = new Map<string, BrowserShortcut>([
  ...BOTH_PLATFORMS,
  ...COMMAND_KEYS.map(([chord, shortcut]): [string, BrowserShortcut] => [
    `ctrl+${chord}`,
    shortcut,
  ]),
  ["ctrl+shift+KeyI", "devtools"],
  ["alt+ArrowLeft", "back"],
  ["alt+ArrowRight", "forward"],
]);

// A key press as one string, its modifiers in a fixed order: "meta+shift+KeyR".
const chordOf = (input: KeyInput): string =>
  [
    input.meta && "meta",
    input.control && "ctrl",
    input.alt && "alt",
    input.shift && "shift",
    input.code,
  ]
    .filter(Boolean)
    .join("+");

// Chrome's zoom levels.
const ZOOM_FACTORS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
];

/** The page zoom after ⌘=, ⌘- or ⌘0: the next of Chrome's levels from wherever it is now. */
export const stepZoom = (
  current: number,
  shortcut: Extract<BrowserShortcut, "zoom-in" | "zoom-out" | "zoom-reset">,
): number => {
  if (shortcut === "zoom-reset") return 1;
  if (shortcut === "zoom-in") {
    return ZOOM_FACTORS.find((factor) => factor > current + 0.001) ?? current;
  }
  return ZOOM_FACTORS.findLast((factor) => factor < current - 0.001) ?? current;
};
