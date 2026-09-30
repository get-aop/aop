import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import { getSettings } from "../api/client";
import { useRuntimeConfiguration } from "../hooks/runtime-configuration";
import { SettingsAbout } from "../settings/settings-about";
import { SettingsExecHosts } from "../settings/settings-exec-hosts";
import {
  mergeSavedSettings,
  normalizeSavedSettingValue,
  SettingsGeneral,
} from "../settings/settings-general";
import { SettingsRepositories } from "../settings/settings-repositories";
import { SettingsRuntimes } from "../settings/settings-runtimes";
import {
  closeSettingsDialog,
  openSettingsDialog,
  type SettingsSection,
  useDialogs,
} from "./dialog-store";

const SECTION_LABELS: Record<SettingsSection, string> = {
  general: "General",
  repositories: "Repositories",
  runtimes: "Runtimes",
  "exec-hosts": "Execution hosts",
  about: "About",
};

/** Host settings, 780×580 with a side nav. A project's own settings live on the project. */
export const SettingsDialog = () => {
  const dialogs = useDialogs();

  return (
    <Dialog
      open={dialogs.settings.open}
      onOpenChange={(open) => (open ? undefined : closeSettingsDialog())}
    >
      <DialogContent
        data-testid="settings-dialog"
        className="flex h-[580px] max-h-[85vh] w-[780px] gap-0 overflow-hidden p-0"
      >
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border p-2 pt-4">
          {(Object.keys(SECTION_LABELS) as SettingsSection[]).map((section) => (
            <button
              key={section}
              type="button"
              data-testid={`settings-nav-${section}`}
              onClick={() => openSettingsDialog(section)}
              className={cn(
                "flex h-8 items-center rounded-row px-2 text-left text-[13px] font-medium transition-colors duration-[120ms]",
                dialogs.settings.section === section
                  ? "bg-active text-text"
                  : "text-text-muted hover:bg-hover hover:text-text",
              )}
            >
              {SECTION_LABELS[section]}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle className="text-[14px]">
              {SECTION_LABELS[dialogs.settings.section]}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <SettingsSectionHost section={dialogs.settings.section} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/** Per-section data wiring; each section owns its fetches. */
const SettingsSectionHost = ({ section }: { section: SettingsSection }) => {
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const { providers: runtimeConfigurations } = useRuntimeConfiguration();

  useEffect(() => {
    if (section !== "general" || loaded) return;
    void getSettings()
      .then((settings) => {
        const values: Record<string, string> = {};
        for (const setting of settings) {
          values[setting.key] = normalizeSavedSettingValue(setting.key, setting.value);
        }
        setSavedValues(values);
        setEditedValues(values);
      })
      .catch(() => toast.error("Failed to load settings"))
      .finally(() => setLoaded(true));
  }, [section, loaded]);

  if (section === "repositories") return <SettingsRepositories />;
  if (section === "runtimes") return <SettingsRuntimes />;
  if (section === "exec-hosts") return <SettingsExecHosts />;
  if (section === "about") return <SettingsAbout />;
  return (
    <SettingsGeneral
      savedValues={savedValues}
      editedValues={editedValues}
      onChange={(key, value) => setEditedValues((current) => ({ ...current, [key]: value }))}
      onSaved={(settings) => {
        setSavedValues((prev) => mergeSavedSettings(prev, settings));
        setEditedValues((prev) => mergeSavedSettings(prev, settings));
      }}
      runtimeConfigurations={runtimeConfigurations}
    />
  );
};
