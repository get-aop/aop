/** How the project screen lays its panes out, by how much room the screen has. */
export type LayoutMode =
  /** Chat and panel next to each other, with a divider the person can drag. */
  | "side"
  /** The panel slides over the chat. */
  | "overlay"
  /** One pane at a time, switched from the top bar. */
  | "single";

export const PANEL_MIN_WIDTH = 360;
export const PANEL_DEFAULT_WIDTH = 520;
/** What the chat keeps when the panel is widened. */
export const CHAT_MIN_WIDTH = 340;

const SIDE_MIN = 900;
const OVERLAY_MIN = 600;
/** What stays uncovered to the left of an overlaid panel. */
const OVERLAY_MARGIN = 48;

/** The mode for a screen `width` pixels wide (the room right of the projects sidebar). */
export const layoutModeFor = (width: number): LayoutMode => {
  if (width >= SIDE_MIN) return "side";
  return width >= OVERLAY_MIN ? "overlay" : "single";
};

/** `width` held between the panel's minimum and what leaves the chat its own minimum. */
export const clampPanelWidth = (width: number, containerWidth: number): number => {
  const widest = Math.max(PANEL_MIN_WIDTH, containerWidth - CHAT_MIN_WIDTH);
  return Math.round(Math.min(Math.max(width, PANEL_MIN_WIDTH), widest));
};

/**
 * The width the panel is drawn at. Beside the chat it leaves the chat its minimum; over the chat
 * it may take nearly all the room, since the chat underneath is covered anyway.
 */
export const panelWidthFor = (mode: LayoutMode, width: number, containerWidth: number): number =>
  mode === "side"
    ? clampPanelWidth(width, containerWidth)
    : Math.max(PANEL_MIN_WIDTH, Math.min(Math.round(width), containerWidth - OVERLAY_MARGIN));

export interface PanelPrefs {
  open: boolean;
  width: number;
}

const STORAGE_KEY = "aop:threads-panel:v1";

export const DEFAULT_PANEL_PREFS: PanelPrefs = { open: true, width: PANEL_DEFAULT_WIDTH };

/** What this browser remembers of the panel; storage that is blocked or garbled reads as the defaults. */
export const loadPanelPrefs = (): PanelPrefs => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PANEL_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PANEL_PREFS;
    const { open, width } = parsed as Record<string, unknown>;
    return {
      open: typeof open === "boolean" ? open : DEFAULT_PANEL_PREFS.open,
      width:
        typeof width === "number" && Number.isFinite(width) && width >= PANEL_MIN_WIDTH
          ? width
          : DEFAULT_PANEL_PREFS.width,
    };
  } catch {
    return DEFAULT_PANEL_PREFS;
  }
};

export const savePanelPrefs = (prefs: PanelPrefs): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage is blocked or full: the panel still works, it just is not remembered.
  }
};
