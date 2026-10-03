import { API_VERSION, buildChannel } from "@aop/common";
import type { ReactNode } from "react";
import { Card } from "@/ui/card";
import { openSettingsDialog } from "../shell/dialog-store";
import { useAppUpdates } from "../updates/app-update-store";
import { platformName } from "../updates/update-rows";
import { useUpdates } from "../updates/update-store";
import { useUpdateStatus } from "../updates/use-update-status";

/**
 * Settings §About: the versions only (this app, the host, the channel, the host API). Whether
 * something newer is out, and installing it, is on AOP settings › Updates.
 */
export const SettingsAbout = () => {
  useUpdateStatus();
  const status = useUpdates().status;
  const { info } = useAppUpdates();
  return (
    <div data-testid="section-about" className="flex flex-col gap-3 p-4">
      <Card className="gap-0 px-4 py-3">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          {info ? (
            <Row label="This app" testId="about-app-version">
              {info.name} {info.version} for {platformName(info.platform) ?? info.platform}
            </Row>
          ) : null}
          <Row label={status ? `Host ${status.hostName}` : "Host"} testId="about-host-version">
            {status?.current ?? "…"}
          </Row>
          <Row label="Channel" testId="about-channel">
            {buildChannel().id === "nightly" ? "Nightly" : "Stable"}
          </Row>
          <Row label="Host API" testId="about-api-version">
            {API_VERSION}
          </Row>
        </dl>
      </Card>
      <button
        type="button"
        data-testid="about-updates-link"
        className="w-fit px-1 text-[12.5px] text-running hover:underline"
        onClick={() => openSettingsDialog("updates")}
      >
        Updates and release notes are in AOP settings › Updates
      </button>
    </div>
  );
};

const Row = ({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) => (
  <>
    <dt className="text-text-subtle">{label}</dt>
    <dd data-testid={testId} className="text-text">
      {children}
    </dd>
  </>
);
