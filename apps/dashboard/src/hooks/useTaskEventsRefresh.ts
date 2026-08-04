import type { getStatus } from "../api/client";

type DashboardStatus = Awaited<ReturnType<typeof getStatus>>;
type ComparableDashboardStatus = Pick<
  DashboardStatus,
  "tasks" | "capacity" | "swimlanes" | "repos"
>;

interface RefreshDashboardStatusOptions {
  nextSeq: () => number;
  getLatestSeq: () => number;
  loadStatus: () => Promise<DashboardStatus>;
  applyStatus: (status: DashboardStatus) => void;
}

export const refreshDashboardStatus = async ({
  nextSeq,
  getLatestSeq,
  loadStatus,
  applyStatus,
}: RefreshDashboardStatusOptions) => {
  const seq = nextSeq();
  const status = await loadStatus();
  if (seq !== getLatestSeq()) return;

  applyStatus(status);
};

export const dashboardStatusUnchanged = (
  previous: ComparableDashboardStatus,
  current: DashboardStatus,
): boolean =>
  previous.capacity.working === current.capacity.working &&
  previous.capacity.max === current.capacity.max &&
  stableJson(previous.tasks) === stableJson(current.tasks) &&
  stableJson(previous.swimlanes) === stableJson(current.swimlanes) &&
  stableJson(previous.repos) === stableJson(current.repos);

const stableJson = (value: unknown): string => JSON.stringify(value);
