import { buildChannel, type PreviousUpdate, type UpdateStatus } from "@aop/common";
import type { ReactNode } from "react";
import { formatAgo } from "../projects/selectors";

/** The host's versions, when it last looked and how often, and what the update brings. */
export const HostUpdateDetails = ({ status }: { status: UpdateStatus }) => {
  const driver = status.includes.cuaDriver;
  return (
    <dl
      data-testid="settings-updates-host-details"
      className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-[12px]"
    >
      <Detail label="Version">
        {status.available && status.latest
          ? `${status.current} → ${status.latest}`
          : status.current}
      </Detail>
      <Detail label="Last check">
        {status.checkedAt ? formatAgo(status.checkedAt) : "Not yet"} ·{" "}
        {buildChannel().id === "nightly" ? "hourly" : "daily"}
      </Detail>
      {status.download.state !== "idle" ? (
        <Detail label="Download">{downloadText(status.download)}</Detail>
      ) : null}
      {driver ? (
        <Detail label="Includes">
          CUA Driver {driver.from} → {driver.to}
        </Detail>
      ) : null}
    </dl>
  );
};

const downloadText = (download: UpdateStatus["download"]): string => {
  if (download.state === "ready") return `${download.version} downloaded and checked`;
  if (download.state === "downloading") return `Downloading ${download.version ?? ""}…`;
  return `Could not download: ${download.error ?? "unknown error"}`;
};

/** "Previous update: Yesterday 22:45, from .16 (took 9 s)". */
export const PreviousUpdateLine = ({ previous }: { previous: PreviousUpdate | null }) =>
  previous ? (
    <p data-testid="settings-updates-previous" className="text-[12px] text-text-subtle">
      {previousText(previous)}
    </p>
  ) : null;

export const previousText = (previous: PreviousUpdate): string => {
  const when = formatAgo(previous.at);
  const took = previous.seconds !== null ? ` (took ${Math.round(previous.seconds)} s)` : "";
  return previous.ok
    ? `Previous update ${when}: ${previous.from} → ${previous.to ?? "?"}${took}.`
    : `Previous update ${when} failed: ${previous.error ?? "unknown error"}`;
};

const Detail = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt className="text-text-subtle">{label}</dt>
    <dd className="text-text">{children}</dd>
  </>
);
