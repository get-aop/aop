import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import { getSettings } from "../api/client";
import { useRuntimeConfiguration } from "../hooks/runtime-configuration";
import { needsAttention, useHostSetup } from "../host-setup/host-setup-store";
import { noteSavedSettings } from "../settings/display-name";
import { SettingsAbout } from "../settings/settings-about";
import { SettingsComputerUse } from "../settings/settings-computer-use";
import { mergeSavedSettings, SettingsGeneral } from "../settings/settings-general";
import { SettingsHost } from "../settings/settings-host";
import { SettingsRepositories } from "../settings/settings-repositories";
import { SettingsRuntimes } from "../settings/settings-runtimes";
import { SettingsUpdates } from "../settings/settings-updates";
import { SettingsConnections } from "../settings/slack/SettingsConnections";
import { useUpdateRows } from "../updates/use-update-rows";
import {
  closeSettingsDialog,
  openSettingsDialog,
  type SettingsSection,
  useDialogs,
} from "./dialog-store";

const SECTION_LABELS: Record<SettingsSection, string> = {
  general: "General",
  host: "Host",
  updates: "Updates",
  repositories: "Repositories",
  runtimes: "Runtimes",
  "computer-use": "Computer use",
  connections: "Connections",
  about: "About",
};

const SECTIONS = Object.keys(SECTION_LABELS) as SettingsSection[];

/** Host settings, 780×580 with a side nav. A project's own settings live on the project. */
export const SettingsDialog = () => {
  const dialogs = useDialogs();
  const current = dialogs.settings.section;
  const dots: Partial<Record<SettingsSection, string>> = {
    host: needsAttention(useHostSetup().setup) ? "bg-waiting" : undefined,
    updates: useUpdateRows().rows.some((row) => row.attention) ? "bg-running" : undefined,
  };

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
          {SECTIONS.map((section) => (
            <button
              key={section}
              type="button"
              data-testid={`settings-nav-${section}`}
              onClick={() => openSettingsDialog(section)}
              className={cn(
                "flex h-8 items-center rounded-row px-2 text-left text-[13px] font-medium transition-colors duration-[120ms]",
                current === section
                  ? "bg-active text-text"
                  : "text-text-muted hover:bg-hover hover:text-text",
              )}
            >
              <span className="flex-1">{SECTION_LABELS[section]}</span>
              {dots[section] ? (
                <span
                  data-testid={`settings-nav-dot-${section}`}
                  aria-hidden="true"
                  className={cn("size-1.5 shrink-0 rounded-full", dots[section])}
                />
              ) : null}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle className="text-[14px]">{SECTION_LABELS[current]}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <SettingsSectionHost section={current} />
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
        for (const setting of settings) values[setting.key] = setting.value;
        setSavedValues(values);
        setEditedValues(values);
      })
      .catch(() => toast.error("Failed to load settings"))
      .finally(() => setLoaded(true));
  }, [section, loaded]);

  if (section === "repositories") return <SettingsRepositories />;
  if (section === "runtimes") return <SettingsRuntimes />;
  if (section === "computer-use") return <SettingsComputerUse />;
  if (section === "host") return <SettingsHost />;
  if (section === "updates") return <SettingsUpdates />;
  if (section === "connections") return <SettingsConnections />;
  if (section === "about") return <SettingsAbout />;
  return (
    <SettingsGeneral
      savedValues={savedValues}
      editedValues={editedValues}
      onChange={(key, value) => setEditedValues((current) => ({ ...current, [key]: value }))}
      onSaved={(settings) => {
        noteSavedSettings(settings);
        setSavedValues((prev) => mergeSavedSettings(prev, settings));
        setEditedValues((prev) => mergeSavedSettings(prev, settings));
      }}
      runtimeConfigurations={runtimeConfigurations}
    />
  );
};
