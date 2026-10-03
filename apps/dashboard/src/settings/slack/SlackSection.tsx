import type { SlackConnection } from "@aop/common";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { SlackConnected } from "./SlackConnected";
import { SlackPreferences } from "./SlackPreferences";
import { SlackRules } from "./SlackRules";
import { SlackSetup } from "./SlackSetup";
import { useSlackConnection } from "./use-slack-connection";

type Tab = "connection" | "rules" | "notifications";

const TAB_LABEL: Record<Tab, string> = {
  connection: "Connection",
  rules: "Rules",
  notifications: "Notifications and storage",
};

/** Slack: the guided setup until it is connected, then its connection, rules and preferences. */
export const SlackSection = () => {
  const [waiting, setWaiting] = useState(false);
  const { sources, error, reload } = useSlackConnection(waiting);
  const slack = sources?.slack ?? null;
  useEffect(() => {
    if (slack) setWaiting(false);
  }, [slack]);

  if (error) return <p className="text-[12.5px] text-blocked">Could not ask the host: {error}</p>;
  if (!sources) return <p className="text-[12.5px] text-text-subtle">Asking the host…</p>;
  if (!slack) {
    return (
      <SlackSetup
        importAvailable={sources.slackImportAvailable}
        onWaiting={setWaiting}
        onConnected={() => void reload()}
      />
    );
  }
  return <ConnectedTabs slack={slack} onChanged={() => void reload()} />;
};

const ConnectedTabs = ({ slack, onChanged }: { slack: SlackConnection; onChanged: () => void }) => {
  const [tab, setTab] = useState<Tab>("connection");
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="flex flex-wrap gap-1">
        {(Object.keys(TAB_LABEL) as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            data-testid={`slack-tab-${name}`}
            onClick={() => setTab(name)}
            className={cn(
              "h-7 rounded-row px-2 text-[12.5px]",
              tab === name
                ? "bg-active text-text"
                : "text-text-muted hover:bg-hover hover:text-text",
            )}
          >
            {TAB_LABEL[name]}
          </button>
        ))}
      </div>
      {tab === "connection" ? <SlackConnected slack={slack} onChanged={onChanged} /> : null}
      {tab === "rules" ? <SlackRules /> : null}
      {tab === "notifications" ? <SlackPreferences slack={slack} onChanged={onChanged} /> : null}
    </div>
  );
};
