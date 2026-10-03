import { SlackMark } from "./SlackMark";
import { SlackSection } from "./SlackSection";

/**
 * AOP settings › Connections: host-wide connections to the person's own accounts. Slack is the
 * first; the Inbox's later sources go here too. Issue trackers stay per project.
 */
export const SettingsConnections = () => (
  <div data-testid="settings-connections" className="flex flex-col gap-4 p-4">
    <section className="flex flex-col gap-3 rounded-card border border-border p-3">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-text">
        <SlackMark className="size-4" />
        Slack
      </h2>
      <SlackSection />
    </section>
  </div>
);
