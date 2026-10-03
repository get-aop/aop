import { type CuaLeaseHolder, type CuaLeaseWaiter, cuaHolderName, cuaLinePlace } from "@aop/common";
import { useWatchedLiveView } from "../live-view/live-view-store";
import { formatShortTimestamp } from "../projects/chat/chat-time";
import { closeSettingsDialog } from "../shell/dialog-store";
import { Link, threadPath } from "../shell/router";

/**
 * Which thread uses the host's screen now and which wait for it, from the live view's status: the
 * same poll that keeps the live view current, so this adds no request of its own.
 */
export const SettingsCuaLease = () => {
  const lease = useWatchedLiveView().status?.lease ?? null;
  return (
    <section data-testid="settings-cu-lease" className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-text">Who uses it now</h2>
      <p className="text-[12px] text-text-subtle">
        One thread at a time drives the host's screen; the others wait in line and go on by
        themselves.
        {lease
          ? ` The host takes it back from a thread after ${minutes(lease.idleReleaseMs)} without a call.`
          : ""}
      </p>
      {lease ? (
        <>
          <Holder holder={lease.holder} />
          {lease.queue.length > 0 ? (
            <ol data-testid="settings-cu-lease-queue" className="flex flex-col gap-1">
              {lease.queue.map((waiter) => (
                <Waiter key={waiter.threadId} waiter={waiter} />
              ))}
            </ol>
          ) : null}
        </>
      ) : (
        <p className="text-[12.5px] text-text-subtle">Asking the host…</p>
      )}
    </section>
  );
};

const Holder = ({ holder }: { holder: CuaLeaseHolder | null }) => (
  <p
    data-testid="settings-cu-lease-holder"
    data-holder={holder ? (holder.kind === "thread" ? holder.threadId : "external") : "none"}
    className="rounded-row border border-border bg-raised px-3 py-2 text-[12.5px] text-text"
  >
    {holder === null ? (
      <span className="text-text-muted">Nobody is using computer use.</span>
    ) : (
      <>
        <span className="text-text-muted">In use by </span>
        {holder.kind === "thread" ? (
          <ThreadLink
            projectId={holder.projectId}
            threadId={holder.threadId}
            title={holder.title}
          />
        ) : (
          cuaHolderName(holder)
        )}
        {holder.since ? (
          <span className="text-text-subtle"> since {formatShortTimestamp(holder.since)}</span>
        ) : null}
      </>
    )}
  </p>
);

const Waiter = ({ waiter }: { waiter: CuaLeaseWaiter }) => (
  <li
    data-testid="settings-cu-lease-waiter"
    data-position={waiter.position}
    className="flex items-center gap-2 px-3 text-[12.5px] text-text"
  >
    <span className="w-24 shrink-0 text-text-subtle">{cuaLinePlace(waiter.position)} in line</span>
    <ThreadLink projectId={waiter.projectId} threadId={waiter.threadId} title={waiter.title} />
  </li>
);

// The thread opens under the dialog, so the dialog closes first.
const ThreadLink = ({
  projectId,
  threadId,
  title,
}: {
  projectId: string;
  threadId: string;
  title: string;
}) => (
  <Link
    to={threadPath(projectId, threadId)}
    onClick={closeSettingsDialog}
    className="min-w-0 truncate font-medium text-text hover:underline"
  >
    {title}
  </Link>
);

const minutes = (ms: number): string => {
  const count = Math.max(1, Math.round(ms / 60_000));
  return count === 1 ? "a minute" : `${count} minutes`;
};
