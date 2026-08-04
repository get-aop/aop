import { ExternalLinkIcon } from "lucide-react";

import { DashboardVersion } from "../components/DashboardVersion";

/** Settings §About — version/build row (with update panel) + release notes. */
export const SettingsAbout = () => {
  return (
    <div data-testid="section-about" className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3 rounded-row border border-border bg-raised px-3 py-2.5">
        <span className="text-[13px] font-semibold text-text">AOP</span>
        <DashboardVersion />
      </div>

      <a
        href="https://github.com/aop/aop/releases"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 rounded-row px-1 text-[12.5px] text-running hover:underline"
      >
        Release notes
        <ExternalLinkIcon className="size-3" />
      </a>
    </div>
  );
};
