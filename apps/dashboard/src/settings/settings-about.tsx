import { buildChannel, type UpdateStatus } from "@aop/common";
import { ExternalLinkIcon } from "lucide-react";

import { Button } from "@/ui/button";
import { DashboardVersion } from "../components/DashboardVersion";
import { ReleaseNotesLink, UpdateNowButton } from "../updates/UpdateNotice";
import { checkForUpdates, useUpdates } from "../updates/update-store";
import { useUpdateStatus } from "../updates/use-update-status";
import { useIsHostOwner } from "./use-host-owner";

/** Settings §About: the host's version, whether a newer one is out, and a link to the release notes. */
export const SettingsAbout = () => {
  // UpdateStatusRow below reads the host's status; this only shares what it found.
  const notesUrl = releaseNotesUrl(useUpdates().status);
  return (
    <div data-testid="section-about" className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3 rounded-row border border-border bg-raised px-3 py-2.5">
        <span className="text-[13px] font-semibold text-text">AOP</span>
        <DashboardVersion />
      </div>

      <UpdateStatusRow />

      {notesUrl ? (
        <ReleaseNotesLink
          url={notesUrl}
          testId="about-release-notes"
          className="flex items-center gap-1.5 rounded-row px-1 text-[12.5px] text-running hover:underline"
        >
          Release notes
          <ExternalLinkIcon className="size-3" />
        </ReleaseNotesLink>
      ) : null}
    </div>
  );
};

/** Stable releases are also on GitHub; AOP Nightly's builds are only in the host's feed. */
const STABLE_RELEASES_URL = "https://github.com/get-aop/aop/releases";

/** The notes of the newest release the host has seen, else the stable release list. */
const releaseNotesUrl = (status: UpdateStatus | null): string | null =>
  status?.releaseUrl ?? (buildChannel().id === "stable" ? STABLE_RELEASES_URL : null);

const UpdateStatusRow = () => {
  const { status, checking, target } = useUpdateStatus();
  const owner = useIsHostOwner(true);
  if (!status?.supported) return null;

  const available = status.enabled && status.available && status.latest;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-row border border-border px-3 py-2.5">
      <span data-testid="about-update-status" className="text-[12.5px] text-text">
        {statusText(status, Boolean(available))}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          data-testid="about-check-updates"
          disabled={checking || target !== null}
          onClick={() => void checkForUpdates()}
        >
          {checking ? "Checking…" : "Check now"}
        </Button>
        {owner && available && target === null ? <UpdateNowButton /> : null}
      </span>
    </div>
  );
};

const statusText = (
  status: NonNullable<ReturnType<typeof useUpdateStatus>["status"]>,
  available: boolean,
): string => {
  if (available) return `Update available (${status.latest})`;
  if (status.checkError) return "Could not check for updates";
  return status.enabled ? "Up to date" : "Update checks are off";
};
