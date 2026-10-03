import { buildChannel, DEFAULT_UPDATE_INSTALL_WINDOW, type UpdateStatus } from "@aop/common";
import { useState } from "react";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { formatAgo } from "../projects/selectors";
import { setAppAutoDownload, useAppUpdates } from "../updates/app-update-store";
import { UpdateRow } from "../updates/UpdateRow";
import { cannotUpdateReason } from "../updates/update-rows";
import { checkEverything, useUpdateRows } from "../updates/use-update-rows";
import { ChoiceGroup, ToggleRow } from "./settings-choice";
import { HostUpdateDetails, PreviousUpdateLine } from "./settings-updates-details";
import { type HostSettings, useHostSettings } from "./use-host-settings";

/**
 * AOP settings › Updates: the one place for update policy. This app (desktop only), the host and
 * its agent CLIs, each with what it runs, what is out and how it updates, then who may update
 * the host. Whoever may not change a setting sees it read-only, with the reason.
 */
export const SettingsUpdates = () => {
  const { host, rows, checking } = useUpdateRows();
  const settings = useHostSettings();
  const status = host.status;
  const canUpdate = status?.canUpdate ?? false;

  return (
    <div data-testid="section-updates" className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-text-subtle">
          {status?.checkedAt ? `Checked ${formatAgo(status.checkedAt)}` : "Not checked yet"}
        </span>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          className="ml-auto"
          data-testid="settings-updates-check"
          disabled={checking}
          onClick={() => void checkEverything()}
        >
          {checking ? "Checking…" : "Check for updates"}
        </Button>
      </div>
      <ChannelLine />
      {status && !canUpdate ? (
        <p data-testid="settings-updates-readonly" className="text-[12px] text-waiting">
          {cannotUpdateReason(status.hostName)} You can see these settings but not change them.
        </p>
      ) : null}
      <AppCard rows={rows} />
      {status ? (
        <HostCard status={status} rows={rows} settings={settings} canUpdate={canUpdate} />
      ) : null}
      <CliCard
        rows={rows}
        hostName={status?.hostName ?? ""}
        settings={settings}
        canUpdate={canUpdate}
      />
      {status ? <WhoCard status={status} settings={settings} /> : null}
    </div>
  );
};

const ChannelLine = () => {
  const [open, setOpen] = useState(false);
  const nightly = buildChannel().id === "nightly";
  return (
    <div className="text-[12px] text-text-muted">
      <span data-testid="settings-updates-channel">
        Channel:{" "}
        {nightly ? "Nightly. A build of main after every merge." : "Stable. Tested releases."}
      </span>{" "}
      <button
        type="button"
        data-testid="settings-updates-switch-channel"
        className="text-running hover:underline"
        onClick={() => setOpen((shown) => !shown)}
      >
        {nightly ? "Switch to Stable" : "Try Nightly"}
      </button>
      {open ? (
        <p
          data-testid="settings-updates-channel-howto"
          className="mt-1.5 max-w-xl text-text-subtle"
        >
          The channel is a separate install, so it can't be a switch here.{" "}
          {nightly ? "Stable" : "AOP Nightly"} runs beside this one with its own data and port:
          install it with{" "}
          <code className="rounded bg-canvas px-1 text-[11.5px] text-text">
            {nightly
              ? "curl -fsSL https://getaop.com/install.sh | sh"
              : "curl -fsSL https://getaop.com/nightly/install.sh | sh"}
          </code>{" "}
          on the host, and register the same repositories there.
        </p>
      ) : null}
    </div>
  );
};

const rowById = (rows: ReturnType<typeof useUpdateRows>["rows"], id: string) =>
  rows.find((row) => row.id === id) ?? null;

const AppCard = ({ rows }: { rows: ReturnType<typeof useUpdateRows>["rows"] }) => {
  const { info } = useAppUpdates();
  const row = rowById(rows, "app");
  if (!info || !row) return null;
  return (
    <Card data-testid="settings-updates-app" className="gap-3 px-4 py-3.5">
      <UpdateRow row={row} />
      <ToggleRow
        id="settings-updates-app-auto-download"
        label="Download updates automatically"
        description="Installs when you restart or quit the app. Off: Updates offers “Download and restart”."
        checked={info.autoDownload}
        disabled={false}
        onChange={(checked) => void setAppAutoDownload(checked)}
      />
    </Card>
  );
};

const HostCard = ({
  status,
  rows,
  settings,
  canUpdate,
}: {
  status: UpdateStatus;
  rows: ReturnType<typeof useUpdateRows>["rows"];
  settings: HostSettings;
  canUpdate: boolean;
}) => {
  const row = rowById(rows, "host");
  const values = settings.values;
  const window = values?.update_install_window ?? DEFAULT_UPDATE_INSTALL_WINDOW;
  const [from, to] = window.split("-");
  return (
    <Card data-testid="settings-updates-host" className="gap-3 px-4 py-3.5">
      {row ? <UpdateRow row={row} /> : null}
      <HostUpdateDetails status={status} />
      <PreviousUpdateLine previous={status.previous} />
      {values ? (
        <>
          <ToggleRow
            id="settings-updates-check"
            label="Check for updates"
            description={
              buildChannel().id === "nightly"
                ? "Every hour the host looks for a newer nightly build of main."
                : "Once a day the host looks for a newer release on getaop.com."
            }
            checked={values.update_check !== "false"}
            disabled={!canUpdate}
            onChange={(checked) => void settings.save("update_check", String(checked))}
          />
          <ToggleRow
            id="settings-updates-background-download"
            label="Download updates in the background"
            description="So Update host only has to restart."
            checked={values.update_background_download !== "false"}
            disabled={!canUpdate}
            onChange={(checked) =>
              void settings.save("update_background_download", String(checked))
            }
          />
          <ChoiceGroup
            name="update_install"
            label="Install host updates"
            value={values.update_install ?? "ask"}
            disabled={!canUpdate}
            onChange={(value) => void settings.save("update_install", value)}
            options={[
              {
                value: "ask",
                label: "Ask me",
                sub: "The Updates button shows it. Default on Stable.",
              },
              {
                value: "idle",
                label: "Automatically, when no turn is running",
                sub: "Once the turns running when it arrives have finished. Default on Nightly.",
              },
              {
                value: "window",
                label: `Automatically, between ${from} and ${to} host time, when no turn is running`,
              },
            ]}
          />
        </>
      ) : null}
    </Card>
  );
};

const CliCard = ({
  rows,
  hostName,
  settings,
  canUpdate,
}: {
  rows: ReturnType<typeof useUpdateRows>["rows"];
  hostName: string;
  settings: HostSettings;
  canUpdate: boolean;
}) => {
  const cliRows = rows.filter((row) => row.id.startsWith("cli:"));
  const values = settings.values;
  return (
    <Card data-testid="settings-updates-clis" className="gap-3 px-4 py-3.5">
      <h3 className="text-[12.5px] font-semibold text-text">
        Agent CLIs on {hostName || "the host"}
      </h3>
      {cliRows.length === 0 ? (
        <p className="text-[12px] text-text-subtle">No agent CLI is installed on the host.</p>
      ) : (
        cliRows.map((row) => <UpdateRow key={row.id} row={row} />)
      )}
      {values ? (
        <>
          <IntervalRow
            value={values.agent_cli_check_interval_minutes ?? "60"}
            disabled={!canUpdate}
            onSave={(value) => void settings.save("agent_cli_check_interval_minutes", value)}
          />
          <ToggleRow
            id="settings-updates-cli-auto"
            label="Update agent CLIs automatically"
            description="Running turns are never interrupted: a native install updates at once, a package-manager install waits for them."
            checked={values.agent_cli_auto_update === "true"}
            disabled={!canUpdate}
            onChange={(checked) => void settings.save("agent_cli_auto_update", String(checked))}
          />
        </>
      ) : null}
    </Card>
  );
};

const IntervalRow = ({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) => {
  const [draft, setDraft] = useState(value);
  const valid = /^\d+$/.test(draft) && Number(draft) <= 1440;
  return (
    <div className="flex items-center gap-3">
      <label htmlFor="settings-updates-cli-interval" className="flex-1 text-[12px] text-text">
        Check every
        <span className="block text-[11.5px] text-text-subtle">
          Minutes between checks for a newer agent CLI; 0 turns the check off.
        </span>
      </label>
      <input
        id="settings-updates-cli-interval"
        data-testid="settings-updates-cli-interval"
        inputMode="numeric"
        disabled={disabled}
        aria-invalid={!valid || undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (valid && draft !== value) onSave(draft);
        }}
        className="h-7 w-20 rounded-md border border-border bg-canvas px-2 text-right text-[12.5px] text-text aria-invalid:border-blocked"
      />
      <span className="text-[11.5px] text-text-subtle">min</span>
    </div>
  );
};

const WhoCard = ({ status, settings }: { status: UpdateStatus; settings: HostSettings }) => (
  <Card data-testid="settings-updates-who" className="gap-2 px-4 py-3.5">
    <ChoiceGroup
      name="host_management"
      label="Who can update this host"
      value={settings.values?.host_management ?? status.hostManagement}
      disabled={!status.owner}
      onChange={(value) => void settings.save("host_management", value)}
      options={[
        {
          value: "devices",
          label: "The host and its paired devices",
          sub: "Also lets them pair and revoke devices.",
        },
        {
          value: "owner",
          label: "Only on the host machine",
          sub: "A guard against mistakes, not a security boundary: agents run on the host.",
        },
      ]}
    />
    {status.owner ? null : (
      <p data-testid="settings-updates-who-readonly" className="text-[11.5px] text-text-subtle">
        Only {status.hostName || "the host"} itself can change this.
      </p>
    )}
  </Card>
);
