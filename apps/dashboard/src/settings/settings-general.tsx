import type { RuntimeConfigurationProvider } from "@aop/common";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/ui/card";
import { Spinner } from "@/ui/spinner";
import type { SettingEntry } from "../api/client";
import { updateSettings } from "../api/client";
import { settingError } from "./setting-validation";
import { resolveSettingOptions, SETTINGS_GROUPS, SettingRow } from "./settings-fields";

const AUTO_SAVE_DELAY_MS = 600;

interface SettingsGeneralProps {
  savedValues: Record<string, string>;
  editedValues: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSaved: (settings: SettingEntry[]) => void;
  runtimeConfigurations?: RuntimeConfigurationProvider[];
  afterSections?: ReactNode;
}

/** Settings §General — the settings form on kit chrome with a sticky save bar. */
export const SettingsGeneral = ({
  savedValues,
  editedValues,
  onChange,
  onSaved,
  runtimeConfigurations = [],
  afterSections,
}: SettingsGeneralProps) => {
  const [saving, setSaving] = useState(false);
  const saveInFlightRef = useRef(false);
  const pendingAutoSaveRef = useRef(false);

  const dirtyEntries = useMemo(
    () => buildSavableDirtyEntries(editedValues, savedValues),
    [editedValues, savedValues],
  );

  const persistSettings = useCallback(async () => {
    const entries = buildSavableDirtyEntries(editedValues, savedValues);
    if (entries.length === 0) return;
    if (saveInFlightRef.current) {
      pendingAutoSaveRef.current = true;
      return;
    }

    saveInFlightRef.current = true;
    setSaving(true);
    try {
      await updateSettings(entries);
      onSaved(entries);
      toast.success("Settings saved");
    } catch (error) {
      toast.error(saveFailure(error));
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
      if (pendingAutoSaveRef.current) {
        pendingAutoSaveRef.current = false;
        void persistSettings();
      }
    }
  }, [editedValues, onSaved, savedValues]);

  useEffect(() => {
    if (dirtyEntries.length === 0) return;
    const timeoutId = window.setTimeout(() => {
      void persistSettings();
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [dirtyEntries, persistSettings]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {SETTINGS_GROUPS.map((group) => {
        const groupKeys = group.keys.filter((key) => key in savedValues);
        if (groupKeys.length === 0) return null;
        return (
          // The kit Card ships py-6/gap-6 for padded content. These groups are
          // flush containers whose rows own their dividers, so both are reset —
          // otherwise the header floats in dead space and every divider detaches
          // from its row.
          <Card key={group.label} className="gap-0 overflow-hidden py-0">
            <div className="border-b border-border px-4 py-3 text-[12.5px] font-semibold text-text">
              {group.label}
            </div>
            {groupKeys.map((key, index) => (
              <SettingRow
                key={key}
                settingKey={key}
                value={editedValues[key] ?? ""}
                options={resolveSettingOptions(key, editedValues, runtimeConfigurations)}
                error={settingError(key, editedValues[key] ?? "")}
                onChange={onChange}
                isLast={index === groupKeys.length - 1}
              />
            ))}
          </Card>
        );
      })}

      {afterSections}

      {/* Edits persist on their own, so the only footer left is the reassurance
          that a write is in flight — never a control the user has to press. */}
      <div aria-live="polite" className="flex h-4 items-center justify-end gap-2">
        {saving ? (
          <>
            <Spinner className="size-3.5" />
            <span className="text-[11px] text-text-subtle">Saving</span>
          </>
        ) : null}
      </div>
    </div>
  );
};

const saveFailure = (error: unknown): string =>
  error instanceof Error && error.message ? `Save failed: ${error.message}` : "Save failed";

export const mergeSavedSettings = (
  values: Record<string, string>,
  settings: SettingEntry[],
): Record<string, string> => {
  const next = { ...values };
  for (const { key, value } of settings) next[key] = value;
  return next;
};

// A value the row is flagging as invalid stays on screen for the person to fix and is not sent;
// the other edits still are.
const buildSavableDirtyEntries = (
  editedValues: Record<string, string>,
  savedValues: Record<string, string>,
): SettingEntry[] =>
  Object.entries(editedValues)
    .filter(([key, value]) => value !== savedValues[key] && settingError(key, value) === null)
    .map(([key, value]) => ({ key, value }));
