import type { InboxNotifyMode, SlackConnection } from "@aop/common";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { setSlackNotifications } from "../../api/inbox";
import { getSettings, updateSettings } from "../../api/settings";
import { ChoiceSelect } from "../../inbox/ChoiceSelect";

const NOTIFY: Array<{ mode: InboxNotifyMode; label: string; detail: string }> = [
  {
    mode: "off",
    label: "Off",
    detail: "Slack already notifies you; the Inbox badge still counts.",
  },
  {
    mode: "away",
    label: "Only when I'm away from Slack",
    detail: "DMs and direct mentions while Slack shows you away.",
  },
  { mode: "all", label: "Everything in Needs me", detail: "Every new item." },
];

const RETENTION = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "0", label: "Forever" },
];

/**
 * Desktop notifications (off by default, shown by the AOP desktop app, silenced by Slack's Do
 * Not Disturb) and how long matched messages are kept.
 */
export const SlackPreferences = ({
  slack,
  onChanged,
}: {
  slack: SlackConnection;
  onChanged: () => void;
}) => (
  <div data-testid="slack-preferences" className="flex flex-col gap-5">
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold text-text">Desktop notifications</h3>
      <div className="flex flex-col gap-1">
        {NOTIFY.map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-pressed={slack.notifications === option.mode}
            data-testid={`slack-notify-${option.mode}`}
            onClick={async () => {
              try {
                await setSlackNotifications(option.mode);
                onChanged();
              } catch (cause) {
                toast.error(cause instanceof Error ? cause.message : "Could not save");
              }
            }}
            className={cn(
              "flex flex-col items-start rounded-row border px-3 py-1.5 text-left",
              slack.notifications === option.mode
                ? "border-running bg-active"
                : "border-border hover:bg-hover",
            )}
          >
            <span className="text-[12.5px] text-text">{option.label}</span>
            <span className="text-[12px] text-text-subtle">{option.detail}</span>
          </button>
        ))}
      </div>
      <p className="text-[11.5px] text-text-subtle">
        The AOP desktop app shows them, and a click opens the item. A browser shows the badge only.
        Slack's Do Not Disturb silences them.
      </p>
    </section>
    <Retention />
  </div>
);

const Retention = () => {
  const [days, setDays] = useState<string | null>(null);
  useEffect(() => {
    void getSettings().then((settings) =>
      setDays(settings.find((setting) => setting.key === "inbox_retention_days")?.value ?? "30"),
    );
  }, []);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold text-text">Storage</h3>
      <p className="text-[12.5px] text-text-muted">
        Only messages that matched a rule are kept, on this host, in a file of their own. After this
        long their text is deleted; items linked to a thread keep the link.
      </p>
      <ChoiceSelect
        testId="slack-retention"
        label="Keep messages for"
        value={days}
        options={
          days && !RETENTION.some((option) => option.value === days)
            ? [...RETENTION, { value: days, label: `${days} days` }]
            : RETENTION
        }
        onChange={async (value) => {
          if (!value) return;
          setDays(value);
          try {
            await updateSettings([{ key: "inbox_retention_days", value }]);
            toast.success("Saved");
          } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : "Could not save");
          }
        }}
        className="w-40"
      />
    </section>
  );
};
