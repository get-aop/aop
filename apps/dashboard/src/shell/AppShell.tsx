import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import { SidebarInset, SidebarProvider } from "@/ui/sidebar";
import { Toaster } from "@/ui/sonner";
import { getSettings } from "../api/client";
import { ConfirmationHost } from "../components/ConfirmationHost";
import { AttachRepoDialog } from "../dialogs/AttachRepoDialog";
import { NewSessionDialog } from "../dialogs/NewSessionDialog";
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
import type { ConnectionState } from "../types";
import { SectionWorkflows } from "../workflow/section-workflows";
import { AppRail } from "./AppRail";
import {
  closeSettingsDialog,
  openSettingsDialog,
  type SettingsSection,
  useDialogs,
} from "./dialog-store";
import { useRailProps } from "./rail-store";
import { handleGlobalShortcut } from "./shortcuts";
import { useNewSession } from "./use-new-session";

const SECTION_LABELS: Record<SettingsSection, string> = {
  general: "General",
  repositories: "Repositories",
  runtimes: "Runtimes",
  "exec-hosts": "Execution hosts",
  workflows: "Workflows",
  about: "About",
};

/**
 * Shell: the left rail is the only chrome; Settings (with Workflows inside)
 * is a dialog (PLAN §6.1). Mounts dialog hosts, ⌘K palette, Toaster,
 * ConfirmationHost, and the global keyboard layer.
 */
export const AppShell = ({
  connection,
  onReposChanged,
  children,
}: {
  connection: ConnectionState;
  onReposChanged: () => void;
  children: React.ReactNode;
}) => {
  const rail = useRailProps();
  const newSession = useNewSession(rail);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleGlobalShortcut(event, {
        toggleCommandPalette: () => setCommandOpen((open) => !open),
        newSession,
        openSettings: () => openSettingsDialog("general"),
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newSession]);

  return (
    <SidebarProvider data-testid="app-shell">
      <AppRail connection={connection} onOpenCommand={() => setCommandOpen(true)} />
      <SidebarInset className="min-w-0">{children}</SidebarInset>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen} title="Search sessions">
        <CommandInput placeholder="Search sessions" />
        <CommandList>
          <CommandEmpty>No sessions found</CommandEmpty>
          <CommandGroup heading="Sessions">
            {(rail?.groups ?? [])
              .flatMap((group) => group.sessions)
              .concat(rail?.tasks ?? [])
              .slice(0, 20)
              .map((session) => (
                <CommandItem
                  key={session.id}
                  value={session.title}
                  onSelect={() => {
                    setCommandOpen(false);
                    rail?.onSelect(session.id);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  <span className="text-[11px] text-text-subtle">{session.repoName}</span>
                </CommandItem>
              ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <SettingsDialogHost onReposChanged={onReposChanged} />
      <NewSessionDialog />
      <AttachRepoDialog onAttached={onReposChanged} />
      <Toaster position="bottom-right" />
      <ConfirmationHost />
    </SidebarProvider>
  );
};

/**
 * Settings dialog — 780×580 with side nav. Phase 3 stopgap: legacy settings
 * form inside; sections are rebuilt on kit primitives in Phase 7 and
 * Workflows lands in Phase 6.
 */
const SettingsDialogHost = ({ onReposChanged }: { onReposChanged: () => void }) => {
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
            <SettingsSectionHost
              section={dialogs.settings.section}
              onReposChanged={onReposChanged}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/** Per-section data wiring; each section owns its fetches. */
const SettingsSectionHost = ({
  section,
  onReposChanged,
}: {
  section: SettingsSection;
  onReposChanged: () => void;
}) => {
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

  if (section === "workflows") return <SectionWorkflows onChanged={onReposChanged} />;
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
      onSettingsSaved={onReposChanged}
      runtimeConfigurations={runtimeConfigurations}
    />
  );
};
