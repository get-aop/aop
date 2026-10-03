import type { InboxChannelMode, InboxItem } from "@aop/common";
import { AlarmClockIcon, EllipsisIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Input } from "@/ui/input";
import { getInboxRules, saveInboxRules, setChannelMode, setInboxState } from "../api/inbox";
import { openExternalUrl } from "../api/settings";
import { useProjectsState } from "../projects/ProjectsProvider";
import { ChoiceSelect } from "./ChoiceSelect";
import { snoozeChoices } from "./inbox-format";

/** Snooze: until a time; the item comes back as unread then. */
export const SnoozeMenu = ({
  item,
  onChanged,
}: {
  item: InboxItem;
  onChanged: (item: InboxItem) => void;
}) => {
  const [custom, setCustom] = useState(false);
  const snooze = async (until: Date) => {
    onChanged(await setInboxState(item.id, { state: "snoozed", until: until.toISOString() }));
    toast.success(
      `Snoozed until ${until.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`,
    );
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="secondary" data-testid="inbox-snooze">
            <AlarmClockIcon />
            Snooze
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {snoozeChoices(new Date()).map((choice) => (
            <DropdownMenuItem
              key={choice.id}
              data-testid={`inbox-snooze-${choice.id}`}
              onSelect={() => void snooze(choice.until)}
            >
              {choice.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem data-testid="inbox-snooze-custom" onSelect={() => setCustom(true)}>
            Pick a time…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {custom ? (
        <CustomSnooze onClose={() => setCustom(false)} onSnooze={(until) => void snooze(until)} />
      ) : null}
    </>
  );
};

const CustomSnooze = ({
  onClose,
  onSnooze,
}: {
  onClose: () => void;
  onSnooze: (until: Date) => void;
}) => {
  const [value, setValue] = useState("");
  const until = value ? new Date(value) : null;
  const valid = until !== null && !Number.isNaN(until.getTime()) && until.getTime() > Date.now();
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="w-[min(360px,calc(100vw-2rem))]">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || !until) return;
            onSnooze(until);
            onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-[15px]">Snooze until</DialogTitle>
            <DialogDescription>The item comes back as unread then.</DialogDescription>
          </DialogHeader>
          <Input
            type="datetime-local"
            data-testid="inbox-snooze-at"
            aria-label="Snooze until"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" data-testid="inbox-snooze-save" disabled={!valid}>
              Snooze
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/** Open or copy the Slack link, and the channel's rules: direct mentions only, mute, project. */
export const MoreMenu = ({ item }: { item: InboxItem }) => {
  const [mapping, setMapping] = useState(false);
  const channel = { id: item.conversation.id, name: item.conversation.name };
  const isChannel = item.conversation.kind === "channel";
  const setMode = async (mode: InboxChannelMode, done: string) => {
    try {
      await setChannelMode(channel, mode);
      toast.success(done);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not change the rules");
    }
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="More"
            data-testid="inbox-more"
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {item.permalink ? (
            <>
              <DropdownMenuItem
                data-testid="inbox-more-open"
                onSelect={() => openExternalUrl(item.permalink ?? "")}
              >
                Open in Slack
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="inbox-more-copy"
                onSelect={() =>
                  void navigator.clipboard
                    .writeText(item.permalink ?? "")
                    .then(() => toast.success("Slack link copied"))
                }
              >
                Copy link
              </DropdownMenuItem>
            </>
          ) : null}
          {isChannel ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="inbox-more-direct-only"
                onSelect={() =>
                  void setMode("direct-only", `#${channel.name}: only direct mentions from now on`)
                }
              >
                Only direct mentions in #{channel.name}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="inbox-more-mute"
                onSelect={() => void setMode("muted", `#${channel.name} is muted`)}
              >
                Mute #{channel.name}
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="inbox-more-map" onSelect={() => setMapping(true)}>
                Map #{channel.name} to a project…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {mapping ? <MapChannelDialog channel={channel} onClose={() => setMapping(false)} /> : null}
    </>
  );
};

/** A mapped channel preselects its project in Dispatch and lists under the project filter. */
export const MapChannelDialog = ({
  channel,
  onClose,
}: {
  channel: { id: string; name: string };
  onClose: () => void;
}) => {
  const projects = Object.values(useProjectsState().byId).map((entry) => entry.project);
  const [projectId, setProjectId] = useState<string | null>(null);
  const save = async () => {
    const rules = await getInboxRules();
    const current = rules.channels[channel.id];
    await saveInboxRules({
      ...rules,
      channels: {
        ...rules.channels,
        [channel.id]: {
          mode: current?.mode ?? "all",
          name: channel.name,
          projectId,
        },
      },
    });
    toast.success(projectId ? `#${channel.name} is mapped` : `#${channel.name} is not mapped`);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="w-[min(380px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Map #{channel.name} to a project</DialogTitle>
          <DialogDescription>
            Dispatch then starts in that project, and the Inbox can show only its channels.
          </DialogDescription>
        </DialogHeader>
        <ChoiceSelect
          testId="inbox-map-project"
          label="Project"
          value={projectId}
          none="No project"
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          onChange={setProjectId}
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" data-testid="inbox-map-save" onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
