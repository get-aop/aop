import {
  describeFirstIssue,
  type Project,
  type ProjectPatch,
  type ProjectSettings,
  ProjectSettingsSchema,
} from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type ProjectActions, useProjectActions } from "../use-project-actions";
import { messageOf } from "./errors";

/** How long typing must pause before a text field saves, as in the host's Settings. */
export const TYPING_DELAY_MS = 600;
/** How long a row says "Saved" after its value reached the host. */
export const SAVED_FOR_MS = 2_000;

export type SaveState =
  | { phase: "idle" }
  | { phase: "saving" }
  | { phase: "saved" }
  | { phase: "error"; message: string };

const IDLE: SaveState = { phase: "idle" };

type Key = keyof ProjectSettings;

export interface AutosaveSettings {
  /** What the row shows: what the person chose, else what the project has. */
  value: <K extends Key>(key: K) => ProjectSettings[K];
  /**
   * Changes a setting and saves it. A choice (a select, a switch) saves at once; a `typed` value
   * waits for typing to pause, or for the field to lose focus (`flush`).
   */
  set: <K extends Key>(key: K, next: ProjectSettings[K], options?: { typed?: boolean }) => void;
  /** Saves what is waiting on a typing pause now. */
  flush: () => void;
  /** Where the row's last change is: saving, saved, or refused with the host's words. */
  state: (key: Key) => SaveState;
}

/**
 * Project settings that save themselves, like the host's Settings: no Save button to find and no
 * change left behind. Only the settings the person changed are sent, and a value the schema
 * refuses (a blank name) waits on screen for the person to fix. A section closing with a change
 * still waiting sends it on the way out, and says so if it cannot.
 */
export const useSettingsAutosave = (project: Project): AutosaveSettings => {
  const actions = useProjectActions();
  const [edits, setEdits] = useState<ProjectPatch>({});
  const [states, setStates] = useState<Partial<Record<Key, SaveState>>>({});
  const latest = useRef({ project, edits, actions });
  latest.current = { project, edits, actions };
  // A value the host took in another form (a trimmed name): shown as typed, never sent again.
  const acknowledged = useRef<ProjectPatch>({});
  // What is on its way to the host, so it is not sent twice.
  const inFlight = useRef<ProjectPatch | null>(null);
  // What the host refused, held back until the person changes it, so it cannot sink other saves.
  const refused = useRef<ProjectPatch>({});
  const queued = useRef(false);
  // The section closed: a save still under way can only report through a toast.
  const left = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimers = useRef(new Map<Key, ReturnType<typeof setTimeout>>());

  const mark = useCallback((keys: Key[], state: SaveState) => {
    setStates((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = state;
      return next;
    });
    for (const key of keys) {
      clearTimeout(savedTimers.current.get(key));
      if (state.phase !== "saved") continue;
      const timer = setTimeout(() => {
        setStates((current) =>
          current[key]?.phase === "saved" ? { ...current, [key]: IDLE } : current,
        );
      }, SAVED_FOR_MS);
      savedTimers.current.set(key, timer);
    }
  }, []);

  const accept = useCallback(
    (patch: ProjectPatch, saved: Project) => {
      const edits = settle(latest.current.edits, patch, saved, acknowledged.current);
      latest.current = { ...latest.current, edits };
      setEdits(edits);
      mark(Object.keys(patch) as Key[], { phase: "saved" });
    },
    [mark],
  );

  const refuse = useCallback(
    (patch: ProjectPatch, cause: unknown) => {
      const message = messageOf(cause, "Could not save the setting");
      Object.assign(refused.current, patch);
      mark(Object.keys(patch) as Key[], { phase: "error", message });
      if (left.current) toast.error(`Not saved: ${message}`);
    },
    [mark],
  );

  // One request at a time; a change made meanwhile goes in the next one.
  const save = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    const patch = sendable(latest.current.edits, { ...acknowledged.current, ...refused.current });
    if (Object.keys(patch).length === 0) return;
    inFlight.current = patch;
    mark(Object.keys(patch) as Key[], { phase: "saving" });
    try {
      accept(patch, await latest.current.actions.update(latest.current.project, parsePatch(patch)));
    } catch (cause) {
      refuse(patch, cause);
    }
    inFlight.current = null;
    if (queued.current && !left.current) {
      queued.current = false;
      void save();
    }
  }, [accept, mark, refuse]);

  const saveNow = useCallback(() => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = null;
    void save();
  }, [save]);

  // Done typing: a value the host stored in another form now shows as the host has it.
  const flush = useCallback(() => {
    const edits = Object.fromEntries(
      Object.entries(latest.current.edits).filter(
        ([key, value]) => !holds(acknowledged.current, key as Key, value),
      ),
    ) as ProjectPatch;
    acknowledged.current = {};
    if (Object.keys(edits).length !== Object.keys(latest.current.edits).length) {
      latest.current = { ...latest.current, edits };
      setEdits(edits);
    }
    saveNow();
  }, [saveNow]);

  const set = useCallback(
    <K extends Key>(key: K, next: ProjectSettings[K], options: { typed?: boolean } = {}) => {
      delete acknowledged.current[key];
      delete refused.current[key];
      const others = without(latest.current.edits, key);
      const edits = sameSetting(latest.current.project[key], next)
        ? others
        : { ...others, [key]: next };
      latest.current = { ...latest.current, edits };
      setEdits(edits);
      if (states[key]?.phase === "error") mark([key], IDLE);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (options.typed) typingTimer.current = setTimeout(saveNow, TYPING_DELAY_MS);
      else saveNow();
    },
    [saveNow, mark, states],
  );

  // Leaving the section (another section, ×, Escape) must not drop a change still waiting.
  useEffect(() => {
    const timers = savedTimers.current;
    return () => {
      left.current = true;
      if (typingTimer.current) clearTimeout(typingTimer.current);
      for (const timer of timers.values()) clearTimeout(timer);
      saveOnLeave(latest.current, {
        ...acknowledged.current,
        ...refused.current,
        ...inFlight.current,
      });
    };
  }, []);

  const value = useCallback(
    <K extends Key>(key: K): ProjectSettings[K] =>
      (key in edits ? edits[key] : project[key]) as ProjectSettings[K],
    [edits, project],
  );
  const state = useCallback((key: Key): SaveState => states[key] ?? IDLE, [states]);

  return { value, set, flush, state };
};

/**
 * The changes worth sending: valid, and not among `settled`, the values already with the host,
 * on their way to it, or refused by it.
 */
const sendable = (edits: ProjectPatch, settled: ProjectPatch): ProjectPatch =>
  Object.fromEntries(
    Object.entries(edits).filter(
      ([key, value]) =>
        !holds(settled, key as Key, value) && fieldProblem(key as Key, value) === null,
    ),
  ) as ProjectPatch;

const holds = (patch: ProjectPatch, key: Key, value: unknown): boolean =>
  key in patch && sameSetting(patch[key], value);

const invalidEdits = (edits: ProjectPatch): string[] =>
  Object.entries(edits).flatMap(([key, value]) => {
    const problem = fieldProblem(key as Key, value);
    return problem ? [problem] : [];
  });

const fieldProblem = (key: Key, value: unknown): string | null => {
  const parsed = ProjectSettingsSchema.pick({ [key]: true } as Record<Key, true>).safeParse({
    [key]: value,
  });
  return parsed.success ? null : describeFirstIssue(parsed.error.issues, "Check the setting.");
};

const parsePatch = (patch: ProjectPatch): ProjectPatch =>
  ProjectSettingsSchema.partial().parse(patch) as ProjectPatch;

/**
 * The edits left once the host has `sent`: the ones it stored are dropped, unless the person
 * changed them again meanwhile. One it stored differently (a name with its spaces trimmed) stays
 * on screen while it is being typed, so the caret does not jump, and is marked as already sent.
 */
const settle = (
  edits: ProjectPatch,
  sent: ProjectPatch,
  saved: Project,
  acknowledged: ProjectPatch,
): ProjectPatch => {
  let next = edits;
  for (const [key, value] of Object.entries(sent) as [Key, unknown][]) {
    if (!holds(next, key, value)) continue;
    if (sameSetting(saved[key], value)) next = without(next, key);
    else Object.assign(acknowledged, { [key]: value });
  }
  return next;
};

// A refused value already said why on its row; one the schema refuses has not been said yet.
const saveOnLeave = (
  { project, edits, actions }: { project: Project; edits: ProjectPatch; actions: ProjectActions },
  settled: ProjectPatch,
) => {
  const problems = invalidEdits(edits);
  if (problems.length > 0) toast.error(`Not saved: ${problems.join(" ")}`);
  const patch = sendable(edits, settled);
  if (Object.keys(patch).length === 0) return;
  actions
    .update(project, parsePatch(patch))
    .catch((cause) => toast.error(messageOf(cause, "Could not save the settings")));
};

const without = (patch: ProjectPatch, key: Key): ProjectPatch =>
  Object.fromEntries(Object.entries(patch).filter(([name]) => name !== key)) as ProjectPatch;

// Settings are plain data (strings, and small objects built in one field order).
const sameSetting = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The same states for a setting saved on its own route (computer use): `track` runs the save and
 * the row follows it, "Saved" when it resolves true.
 */
export const useSaveState = (): [SaveState, (run: () => Promise<boolean>) => Promise<void>] => {
  const [state, setState] = useState<SaveState>(IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const track = useCallback(async (run: () => Promise<boolean>) => {
    if (timer.current) clearTimeout(timer.current);
    setState({ phase: "saving" });
    const ok = await run();
    setState(ok ? { phase: "saved" } : IDLE);
    if (ok) timer.current = setTimeout(() => setState(IDLE), SAVED_FOR_MS);
  }, []);
  return [state, track];
};
