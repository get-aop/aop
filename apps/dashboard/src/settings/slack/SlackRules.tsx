import type { InboxChannelMode, InboxRules, SlackChannel } from "@aop/common";
import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { getInboxRules, listSlackChannels, saveInboxRules } from "../../api/inbox";
import { ChoiceSelect } from "../../inbox/ChoiceSelect";
import { SwitchRow } from "../../inbox/fields";
import { useProjectsState } from "../../projects/ProjectsProvider";

type Trigger = "mentions" | "dms" | "threadReplies" | "groups" | "broadcasts";

const TRIGGERS: Array<{ key: Trigger; label: string }> = [
  { key: "mentions", label: "Direct mentions of me" },
  { key: "dms", label: "Direct messages and group DMs" },
  { key: "threadReplies", label: "Replies in threads I started, replied in or was mentioned in" },
  { key: "groups", label: "Groups I'm in (@platform-team, @oncall)" },
  { key: "broadcasts", label: "@here and @channel (not in channels set to only direct mentions)" },
];

const MODES: Array<{ value: InboxChannelMode; label: string }> = [
  { value: "all", label: "Everything that counts" },
  { value: "direct-only", label: "Only direct mentions" },
  { value: "muted", label: "Muted" },
];

/**
 * What reaches the Inbox: the triggers, keywords, and the channels the person changed (every
 * other channel follows the triggers). A rule applies to new messages; a muted channel stores
 * nothing. Each change is saved at once.
 */
export const SlackRules = () => {
  const [rules, setRules] = useState<InboxRules | null>(null);
  useEffect(() => {
    void getInboxRules().then(setRules, () => toast.error("Could not read the rules"));
  }, []);
  if (!rules) return <p className="text-[12.5px] text-text-subtle">Reading the rules…</p>;

  const save = async (next: InboxRules) => {
    setRules(next);
    try {
      setRules(await saveInboxRules(next));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the rules");
    }
  };

  return (
    <div data-testid="slack-rules" className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-text">What reaches the Inbox</h3>
        {TRIGGERS.map((trigger) => (
          <SwitchRow
            key={trigger.key}
            testId={`slack-rule-${trigger.key}`}
            checked={rules[trigger.key]}
            onChange={(on) => void save({ ...rules, [trigger.key]: on })}
          >
            {trigger.label}
          </SwitchRow>
        ))}
      </section>
      <Keywords rules={rules} onSave={save} />
      <Channels rules={rules} onSave={save} />
      <p className="text-[11.5px] text-text-subtle">
        Rules apply to new messages; they do not rewrite the list. Muting from an item adds the
        channel here.
      </p>
    </div>
  );
};

const Keywords = ({
  rules,
  onSave,
}: {
  rules: InboxRules;
  onSave: (rules: InboxRules) => void;
}) => {
  const [draft, setDraft] = useState("");
  const add = () => {
    const word = draft.trim();
    if (!word || rules.keywords.includes(word)) return;
    onSave({ ...rules, keywords: [...rules.keywords, word] });
    setDraft("");
  };
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold text-text">Keywords</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {rules.keywords.map((word) => (
          <span
            key={word}
            data-testid="slack-keyword"
            className="flex items-center gap-1 rounded-row border border-border bg-raised py-0.5 pr-0.5 pl-2 text-[12px] text-text"
          >
            {word}
            <button
              type="button"
              aria-label={`Remove ${word}`}
              onClick={() =>
                onSave({ ...rules, keywords: rules.keywords.filter((other) => other !== word) })
              }
              className="grid size-5 place-items-center rounded-md text-text-subtle hover:bg-hover"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Input
            data-testid="slack-keyword-input"
            aria-label="Add a keyword"
            placeholder="add…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="h-7 w-32 text-[12.5px]"
          />
          <Button type="submit" size="xs" variant="secondary" data-testid="slack-keyword-add">
            Add
          </Button>
        </form>
      </div>
    </section>
  );
};

const Channels = ({
  rules,
  onSave,
}: {
  rules: InboxRules;
  onSave: (rules: InboxRules) => void;
}) => {
  const projects = Object.values(useProjectsState().byId).map((entry) => ({
    value: entry.project.id,
    label: entry.project.name,
  }));
  const [adding, setAdding] = useState<SlackChannel[] | null>(null);
  const entries = Object.entries(rules.channels);
  const setChannel = (id: string, patch: Partial<InboxRules["channels"][string]>) => {
    const current = rules.channels[id] ?? { mode: "all" as const };
    onSave({ ...rules, channels: { ...rules.channels, [id]: { ...current, ...patch } } });
  };
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold text-text">Channels</h3>
      <p className="text-[12px] text-text-subtle">
        Only the ones you changed. A project here preselects it when you dispatch from the channel.
      </p>
      <ul data-testid="slack-channels" className="flex flex-col gap-1.5">
        {entries.map(([id, rule]) => (
          <li key={id} data-testid="slack-channel" className="flex flex-wrap items-center gap-2">
            <span className="w-32 truncate text-[12.5px] text-text">#{rule.name ?? id}</span>
            <ChoiceSelect
              testId={`slack-channel-mode-${id}`}
              label="Mode"
              value={rule.mode}
              options={MODES}
              onChange={(mode) => setChannel(id, { mode: (mode ?? "all") as InboxChannelMode })}
              className="w-44"
            />
            <ChoiceSelect
              testId={`slack-channel-project-${id}`}
              label="Project"
              value={rule.projectId ?? null}
              none="No project"
              options={projects}
              onChange={(projectId) => setChannel(id, { projectId })}
              className="w-40"
            />
            <button
              type="button"
              aria-label={`Forget the rule for #${rule.name ?? id}`}
              onClick={() => {
                const { [id]: _removed, ...rest } = rules.channels;
                onSave({ ...rules, channels: rest });
              }}
              className="grid size-6 place-items-center rounded-md text-text-subtle hover:bg-hover"
            >
              <XIcon className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <ChoiceSelect
          testId="slack-channel-add-pick"
          label="Pick a channel"
          value={null}
          options={adding
            .filter((channel) => !rules.channels[channel.id])
            .map((channel) => ({ value: channel.id, label: `#${channel.name}` }))}
          onChange={(id) => {
            const channel = adding.find((candidate) => candidate.id === id);
            if (channel) setChannel(channel.id, { mode: "all", name: channel.name });
            setAdding(null);
          }}
          className="w-56"
        />
      ) : (
        <Button
          type="button"
          size="xs"
          variant="secondary"
          data-testid="slack-channel-add"
          className="self-start"
          onClick={() =>
            void listSlackChannels().then(setAdding, (cause: unknown) =>
              toast.error(cause instanceof Error ? cause.message : "Could not list channels"),
            )
          }
        >
          + Add a channel
        </Button>
      )}
    </section>
  );
};
