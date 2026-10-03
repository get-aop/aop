import type { InboxItem, InboxLinkInput } from "@aop/common";
import { GitPullRequestIcon, MessageSquareIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { linkInboxItem } from "../api/inbox";
import { listIssues } from "../api/issues";
import { listPullRequests } from "../api/pull-requests";
import { SourceMark } from "../projects/issues/source-marks";
import { useProjectEntry, useProjectsState } from "../projects/ProjectsProvider";
import { ChoiceSelect } from "./ChoiceSelect";

/**
 * Link an item to what the host already lists for a project: the Issues tab's issues (every
 * source it has: GitHub, Linear, Jira), the PRs tab's pull requests and the project's threads.
 * Pasting an issue or pull request address, or an issue key, works too. A link is AOP's own
 * note: nothing is posted to Slack, GitHub, Linear or Jira.
 */
type Tab = "issues" | "pulls" | "threads";

interface Candidate {
  key: string;
  label: string;
  detail: string;
  mark: React.ReactNode;
  link: InboxLinkInput;
}

export const LinkDialog = ({
  item,
  projectFilter,
  onClose,
  onLinked,
}: {
  item: InboxItem;
  projectFilter: string | null;
  onClose: () => void;
  onLinked: (item: InboxItem) => void;
}) => {
  const projects = Object.values(useProjectsState().byId).map((entry) => entry.project);
  const [projectId, setProjectId] = useState<string | null>(
    projectFilter ?? projects[0]?.id ?? null,
  );
  const [tab, setTab] = useState<Tab>("issues");
  const [query, setQuery] = useState("");
  const candidates = useCandidates(projectId, tab);
  const shown = useMemo(
    () =>
      (candidates.list ?? []).filter((candidate) =>
        `${candidate.label} ${candidate.detail}`.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [candidates.list, query],
  );

  const link = async (input: InboxLinkInput) => {
    try {
      onLinked(await linkInboxItem(item.id, input));
      toast.success("Linked");
      onClose();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not link");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        data-testid="inbox-link-dialog"
        className="flex max-h-[85vh] w-[min(560px,calc(100vw-2rem))] flex-col gap-3"
      >
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            Link to an issue, a pull request or a thread
          </DialogTitle>
          <DialogDescription>AOP keeps the link; nothing is posted anywhere.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <ChoiceSelect
            testId="inbox-link-project"
            label="Project"
            value={projectId}
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
            onChange={setProjectId}
            className="w-44"
          />
          <div role="tablist" className="flex gap-1">
            {(["issues", "pulls", "threads"] as const).map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                data-testid={`inbox-link-tab-${name}`}
                onClick={() => setTab(name)}
                className={cn(
                  "h-8 rounded-row px-2 text-[12.5px]",
                  tab === name ? "bg-active text-text" : "text-text-muted hover:bg-hover",
                )}
              >
                {TAB_LABEL[name]}
              </button>
            ))}
          </div>
        </div>
        <Input
          data-testid="inbox-link-search"
          placeholder="Search, or paste an address or key (OPS-1184, #58)"
          aria-label="Search or paste"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <PastedLink query={query} projectId={projectId} onLink={(input) => void link(input)} />
        <ul data-testid="inbox-link-results" className="min-h-0 flex-1 overflow-y-auto">
          {candidates.list === null ? (
            <li className="px-2 py-2 text-[12.5px] text-text-subtle">
              {candidates.error ?? "Loading…"}
            </li>
          ) : null}
          {candidates.list?.length === 0 ? (
            <li className="px-2 py-2 text-[12.5px] text-text-subtle">Nothing here yet.</li>
          ) : null}
          {shown.map((candidate) => (
            <li key={candidate.key}>
              <button
                type="button"
                data-testid="inbox-link-result"
                onClick={() => void link(candidate.link)}
                className="flex w-full items-center gap-2 rounded-row px-2 py-1.5 text-left text-[13px] hover:bg-hover"
              >
                {candidate.mark}
                <span className="truncate text-text">{candidate.label}</span>
                <span className="ml-auto shrink-0 text-[12px] text-text-subtle">
                  {candidate.detail}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
};

const TAB_LABEL: Record<Tab, string> = {
  issues: "Issues",
  pulls: "Pull requests",
  threads: "Threads",
};

/** A pasted address or key, offered as a link of its own. */
const PastedLink = ({
  query,
  projectId,
  onLink,
}: {
  query: string;
  projectId: string | null;
  onLink: (input: InboxLinkInput) => void;
}) => {
  const pasted = parsePasted(query.trim(), projectId);
  if (!pasted) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      data-testid="inbox-link-pasted"
      className="self-start"
      onClick={() => onLink(pasted)}
    >
      Link {pasted.kind === "pull-request" ? "pull request" : "issue"} {pasted.ref}
    </Button>
  );
};

/** `https://github.com/o/r/pull/3` is a pull request; any other address or a KEY-12 or #12 is an issue. */
export const parsePasted = (text: string, projectId: string | null): InboxLinkInput | null => {
  const pull = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(text);
  if (pull) return { kind: "pull-request", ref: `${pull[1]}#${pull[2]}`, url: text, projectId };
  if (/^https?:\/\/\S+$/.test(text)) {
    const key = /([A-Z][A-Z0-9]+-\d+)/.exec(text)?.[1] ?? /\/issues\/(\d+)/.exec(text)?.[1];
    return {
      kind: "issue",
      ref: key ? (key.includes("-") ? key : `#${key}`) : text,
      url: text,
      projectId,
    };
  }
  if (/^([A-Z][A-Z0-9]+-\d+|#\d+)$/.test(text)) return { kind: "issue", ref: text, projectId };
  return null;
};

const useCandidates = (projectId: string | null, tab: Tab) => {
  const [state, setState] = useState<{ list: Candidate[] | null; error: string | null }>({
    list: null,
    error: null,
  });
  const entry = useProjectEntry(projectId ?? "");
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    setState({ list: null, error: null });
    const done = (list: Candidate[]) => live && setState({ list, error: null });
    const failed = (cause: unknown) =>
      live &&
      setState({ list: null, error: cause instanceof Error ? cause.message : String(cause) });
    if (tab === "issues") void issueCandidates(projectId).then(done, failed);
    if (tab === "pulls") void pullCandidates(projectId).then(done, failed);
    return () => {
      live = false;
    };
  }, [projectId, tab]);
  if (tab === "threads" && projectId) {
    const list = (entry?.threads ?? []).map(
      (thread): Candidate => ({
        key: thread.id,
        label: thread.title,
        detail: thread.status,
        mark: <MessageSquareIcon className="size-3.5 text-text-subtle" />,
        link: { kind: "thread", ref: thread.id, projectId, title: thread.title },
      }),
    );
    return { list, error: null };
  }
  return state;
};

const issueCandidates = async (projectId: string): Promise<Candidate[]> =>
  (await listIssues(projectId, { state: "open", limit: 200 })).issues.map((issue) => ({
    key: issue.key,
    label: `${issue.identifier} ${issue.title}`,
    detail: issue.stateName,
    mark: <SourceMark source={issue.source} className="size-3.5" />,
    link: { kind: "issue", ref: issue.key, projectId, title: issue.title, url: issue.url },
  }));

const pullCandidates = async (projectId: string): Promise<Candidate[]> => {
  const response = await listPullRequests(projectId, { state: "open" });
  if (response.status !== "ready") throw new Error(response.message);
  return response.items.map((pull) => ({
    key: `${pull.repo}#${pull.number}`,
    label: `#${pull.number} ${pull.title}`,
    detail: pull.repo,
    mark: <GitPullRequestIcon className="size-3.5 text-text-subtle" />,
    link: {
      kind: "pull-request",
      ref: `${pull.repo}#${pull.number}`,
      projectId,
      title: pull.title,
      url: pull.url,
    },
  }));
};
