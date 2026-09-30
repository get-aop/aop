import {
  describeFirstIssue,
  type Project,
  type ProjectPatch,
  ProjectPatchSchema,
  type ProjectSettings,
} from "@aop/common";
import { useCallback, useState } from "react";
import { PROJECT_FIELD_LABELS } from "../project-fields";
import { useProjectActions } from "../use-project-actions";
import { messageOf } from "./errors";

export interface SettingsDraft {
  /** What the form shows: what the person typed, else what the project has. */
  value: <K extends keyof ProjectSettings>(key: K) => ProjectSettings[K];
  set: <K extends keyof ProjectSettings>(key: K, next: ProjectSettings[K]) => void;
  /** Only the settings that differ from the project. */
  patch: ProjectPatch;
  dirty: boolean;
  saving: boolean;
  /** Why the last save failed, in the host's words. */
  error: string | null;
  /** Resolves true when the host accepted the settings; false when it refused or nothing changed. */
  save: () => Promise<boolean>;
  discard: () => void;
}

/**
 * The edits a person has made to some of a project's settings and not saved yet. It keeps only
 * what they changed and shows the project's own value for the rest, so a setting that changes
 * elsewhere in the meantime (the coordinator lowering a notification level) still shows up.
 */
export const useSettingsDraft = (project: Project): SettingsDraft => {
  const actions = useProjectActions();
  const [patch, setPatch] = useState<ProjectPatch>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = Object.keys(patch).length > 0;

  const value = useCallback(
    <K extends keyof ProjectSettings>(key: K): ProjectSettings[K] =>
      (key in patch ? patch[key] : project[key]) as ProjectSettings[K],
    [patch, project],
  );

  const set = useCallback(
    <K extends keyof ProjectSettings>(key: K, next: ProjectSettings[K]) => {
      setError(null);
      setPatch((current) => {
        const others = Object.fromEntries(
          Object.entries(current).filter(([name]) => name !== key),
        ) as ProjectPatch;
        return sameSetting(project[key], next) ? others : { ...others, [key]: next };
      });
    },
    [project],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return false;
    const parsed = ProjectPatchSchema.safeParse(patch);
    if (!parsed.success) {
      setError(
        describeFirstIssue(
          parsed.error.issues,
          "Check the fields and try again",
          PROJECT_FIELD_LABELS,
        ),
      );
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      await actions.update(project, parsed.data);
      setPatch({});
      return true;
    } catch (cause) {
      setError(messageOf(cause, "Could not save the settings"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [actions, dirty, patch, project]);

  const discard = useCallback(() => {
    setPatch({});
    setError(null);
  }, []);

  return { value, set, patch, dirty, saving, error, save, discard };
};

// Settings are plain data (strings, and small objects built in one field order).
const sameSetting = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
