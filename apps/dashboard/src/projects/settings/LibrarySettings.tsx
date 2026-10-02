import type { LibraryListing, LibrarySettings as Settings } from "@aop/common";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { getLibrary, setLibrarySettings } from "../../api/library";
import { formatBytes } from "../library/library-view";
import { ROW_SELECT_CLASS, SettingRow, SettingsGroup } from "./blocks";
import { messageOf } from "./errors";
import { useSaveState } from "./use-settings-autosave";

const DEFAULT = "default";
const DAY_CHOICES = [7, 14, 30, 90, 180, 365, 0];
const MB_CHOICES = [250, 500, 1024, 2048, 5120, 10240, 0];

/**
 * How long this project's Library keeps what arrived on its own (sent images, agents' files) and
 * how big it may grow. Each saves as soon as it changes, like every project setting; "Host
 * default" follows the host's Settings › Library.
 */
export const LibrarySettings = ({ projectId }: { projectId: string }) => {
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [retentionState, trackRetention] = useSaveState();
  const [capState, trackCap] = useSaveState();

  useEffect(() => {
    let current = true;
    getLibrary(projectId).then(
      (loaded) => current && setListing(loaded),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [projectId]);

  if (!listing) return null;
  const save = (patch: Partial<Settings>) => async () => {
    try {
      setListing(await setLibrarySettings(projectId, { ...listing.settings, ...patch }));
      return true;
    } catch (cause) {
      toast.error(messageOf(cause, "Could not save the Library setting"));
      return false;
    }
  };

  return (
    <div className="mb-2 border-b border-border pb-6">
      <SettingsGroup
        testId="settings-library"
        title="Library storage"
        description={
          <span data-testid="settings-library-usage">
            The Library holds {formatBytes(listing.usage.bytes)}
            {listing.usage.capBytes ? ` of ${formatBytes(listing.usage.capBytes)}` : ""}. Files you
            upload or pin are never removed; the daily cleanup removes the rest by age and, over the
            cap, least recently used first. A message whose image was removed shows it as expired.
          </span>
        }
      >
        <SettingRow
          label="Keep chat attachments and agent files for"
          htmlFor="settings-library-retention"
          status={retentionState}
          control={
            <ChoiceSelect
              id="settings-library-retention"
              value={listing.settings.retentionDays}
              choices={DAY_CHOICES}
              defaultValue={listing.defaults.retentionDays}
              label={dayLabel}
              onChange={(retentionDays) => void trackRetention(save({ retentionDays }))}
            />
          }
        />
        <SettingRow
          label="Library size cap"
          htmlFor="settings-library-cap"
          status={capState}
          control={
            <ChoiceSelect
              id="settings-library-cap"
              value={listing.settings.capMb}
              choices={MB_CHOICES}
              defaultValue={listing.defaults.capMb}
              label={mbLabel}
              onChange={(capMb) => void trackCap(save({ capMb }))}
            />
          }
        />
      </SettingsGroup>
    </div>
  );
};

const ChoiceSelect = ({
  id,
  value,
  choices,
  defaultValue,
  label,
  onChange,
}: {
  id: string;
  value: number | null;
  choices: number[];
  defaultValue: number;
  label: (value: number) => string;
  onChange: (value: number | null) => void;
}) => {
  // A value set elsewhere (the API, an older choice) is still offered, so the select can show it.
  const options = value === null || choices.includes(value) ? choices : [...choices, value];
  return (
    <Select
      value={value === null ? DEFAULT : String(value)}
      onValueChange={(next) => onChange(next === DEFAULT ? null : Number(next))}
    >
      <SelectTrigger id={id} data-testid={id} className={ROW_SELECT_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT}>Host default ({label(defaultValue)})</SelectItem>
        {options.map((choice) => (
          <SelectItem key={choice} value={String(choice)}>
            {label(choice)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

const dayLabel = (days: number): string => {
  if (days === 0) return "Forever";
  if (days % 365 === 0) return days === 365 ? "1 year" : `${days / 365} years`;
  return days === 1 ? "1 day" : `${days} days`;
};

const mbLabel = (mb: number): string =>
  mb === 0 ? "No cap" : mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
