import { useHostVersion } from "../hooks/useHostVersion";

/** The release the host runs, as the host reports it. */
export const DashboardVersion = () => {
  const version = useHostVersion();

  return (
    <div className="flex items-center px-1">
      <span className="text-[11.5px] text-text-subtle">{version ?? "version unavailable"}</span>
    </div>
  );
};
