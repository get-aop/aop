import type { RuntimeConfigurationProvider } from "@aop/common";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/ui/card";
import { Spinner } from "@/ui/spinner";
import type { SettingEntry } from "../api/client";
import { updateSettings } from "../api/client";
import {
  isSettingVisible,
  resolveSettingOptions,
  SETTINGS_GROUPS,
  SettingRow,
} from "./settings-fields";

const MASKED_SECRET_SETTING_VALUE = "********";
/** Legacy secret keys may still exist in saved DB rows; never re-save a masked placeholder. */
const SECRET_SETTING_KEYS = new Set([
  "jira_api_token",
  "jira_client_secret",
  "github_app_private_key",
]);
const AUTO_SAVE_DELAY_MS = 600;

interface SettingsGeneralProps {
  savedValues: Record<string, string>;
  editedValues: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSaved: (settings: SettingEntry[]) => void;
  onSettingsSaved?: () => Promise<void> | void;
  runtimeConfigurations?: RuntimeConfigurationProvider[];
  afterSections?: ReactNode;
}

/** Settings §General — the settings form on kit chrome with a sticky save bar. */
export const SettingsGeneral = ({
  savedValues,
  editedValues,
  onChange,
  onSaved,
  onSettingsSaved,
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
      await onSettingsSaved?.();
      toast.success("Settings saved");
    } catch {
      toast.error("Save failed");
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
      if (pendingAutoSaveRef.current) {
        pendingAutoSaveRef.current = false;
        void persistSettings();
      }
    }
  }, [editedValues, onSaved, onSettingsSaved, savedValues]);

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
        const groupKeys = group.keys.filter(
          (key) => key in savedValues && isSettingVisible(key, editedValues, runtimeConfigurations),
        );
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

export const mergeSavedSettings = (
  values: Record<string, string>,
  settings: SettingEntry[],
): Record<string, string> => {
  const next = { ...values };
  for (const { key, value } of settings) {
    next[key] = normalizeSavedSettingValue(key, value);
  }
  return next;
};

export const normalizeSavedSettingValue = (key: string, value: string): string =>
  SECRET_SETTING_KEYS.has(key) && value.trim().length > 0 ? MASKED_SECRET_SETTING_VALUE : value;

const buildSavableDirtyEntries = (
  editedValues: Record<string, string>,
  savedValues: Record<string, string>,
): SettingEntry[] =>
  Object.entries(editedValues)
    .filter(([key, value]) => value !== savedValues[key])
    .filter(
      ([key, value]) => !(SECRET_SETTING_KEYS.has(key) && value === MASKED_SECRET_SETTING_VALUE),
    )
    .map(([key, value]) => ({ key, value }));
