import {
  JIRA_JQL_MAX,
  JIRA_PROJECTS_MAX,
  type JiraAccount,
  type JiraProjectSummary,
} from "@aop/common";
import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/ui/button";
import { DialogFooter } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { Spinner } from "@/ui/spinner";
import { Textarea } from "@/ui/textarea";
import type { JiraSetup } from "./use-jira-setup";

/**
 * Which issues the project shows: the open issues of the Jira projects picked, newest first, or
 * what an advanced JQL query finds (both narrow each other when both are set). The Issues tab's
 * Open/Closed/All is added on top, so the query need not say. Saving runs the query once on the
 * host, so one Jira cannot run is refused with Jira's own words.
 */
export const JiraFilterStep = ({
  setup,
  account,
  projects,
  onDone,
}: {
  setup: JiraSetup;
  account: JiraAccount;
  projects: JiraProjectSummary[];
  onDone: () => void;
}) => {
  const saved = setup.connection?.filter;
  const [picked, setPicked] = useState<string[]>(saved?.projects ?? []);
  const [jql, setJql] = useState(saved?.jql ?? "");
  const [linkPullRequests, setLinkPullRequests] = useState(
    setup.connection?.linkPullRequests ?? true,
  );
  // A saved project the token no longer lists still shows, so it can be unpicked.
  const listed = useMemo(() => withSaved(projects, saved?.projects ?? []), [projects, saved]);
  const empty = picked.length === 0 && !jql.trim();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-meta text-text-muted">
        Signed in as <span className="text-text">{account.displayName}</span>. Pick the projects
        whose open issues this project shows, newest first.
      </p>
      <ProjectPicker projects={listed} picked={picked} onChange={setPicked} />
      <JqlField value={jql} onChange={setJql} />
      <label className="flex cursor-pointer items-start gap-2.5 text-meta text-text-muted">
        <input
          type="checkbox"
          data-testid="jira-link-prs"
          checked={linkPullRequests}
          onChange={(event) => setLinkPullRequests(event.target.checked)}
          className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-text)]"
        />
        <span>
          Put the issue's key in the titles of pull requests a thread opens for it, so Jira's GitHub
          integration links them.
        </span>
      </label>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={setup.back}>
          Back
        </Button>
        <Button
          size="sm"
          data-testid="jira-save"
          disabled={empty || setup.busy}
          onClick={async () => {
            const filter = { projects: picked, jql: jql.trim() || null };
            if (await setup.save(filter, linkPullRequests)) onDone();
          }}
        >
          {setup.busy ? <Spinner className="size-3.5" /> : null}
          {setup.connection?.configured ? "Save" : "Connect"}
        </Button>
      </DialogFooter>
    </div>
  );
};

/** The projects as checkboxes, with a search once there are many. */
const ProjectPicker = ({
  projects,
  picked,
  onChange,
}: {
  projects: JiraProjectSummary[];
  picked: string[];
  onChange: (picked: string[]) => void;
}) => {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => matching(projects, query), [projects, query]);
  const toggle = (key: string) =>
    onChange(picked.includes(key) ? picked.filter((item) => item !== key) : [...picked, key]);
  return (
    <>
      {projects.length > 8 ? (
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-text-subtle" />
          <Input
            data-testid="jira-project-search"
            aria-label="Find a Jira project"
            placeholder="Find a project"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 bg-input-surface pl-8 text-meta md:text-meta"
          />
        </div>
      ) : null}
      <fieldset
        aria-label="Jira projects"
        data-testid="jira-projects"
        className="m-0 flex max-h-52 min-w-0 flex-col gap-0.5 overflow-y-auto rounded-card border border-border-strong bg-raised p-1"
      >
        {shown.length === 0 ? (
          <p className="px-3 py-2 text-meta text-text-subtle">
            {projects.length === 0
              ? "This token sees no project; use a JQL query below."
              : "No project matches."}
          </p>
        ) : null}
        {shown.map((project) => (
          <label
            key={project.key}
            data-testid="jira-project-option"
            data-key={project.key}
            className="flex cursor-pointer items-center gap-2.5 rounded-row px-2.5 py-1.5 text-meta text-text-muted hover:bg-hover has-[:checked]:bg-active has-[:checked]:text-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-running"
          >
            <input
              type="checkbox"
              checked={picked.includes(project.key)}
              disabled={!picked.includes(project.key) && picked.length >= JIRA_PROJECTS_MAX}
              onChange={() => toggle(project.key)}
              className="size-3.5 shrink-0 accent-[var(--color-text)]"
            />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span className="text-[11px] tabular-nums text-text-subtle">{project.key}</span>
          </label>
        ))}
      </fieldset>
    </>
  );
};

/** The advanced query, behind a link until it is wanted (or already saved). */
const JqlField = ({ value, onChange }: { value: string; onChange: (jql: string) => void }) => {
  const [open, setOpen] = useState(value.trim() !== "");
  if (!open) {
    return (
      <button
        type="button"
        data-testid="jira-jql-open"
        onClick={() => setOpen(true)}
        className="self-start text-meta text-running hover:underline"
      >
        Advanced: filter with JQL
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="jira-jql" className="text-meta text-text">
        JQL filter
      </Label>
      <Textarea
        id="jira-jql"
        data-testid="jira-jql"
        spellCheck={false}
        maxLength={JIRA_JQL_MAX}
        placeholder="assignee = currentUser() AND labels = backend ORDER BY priority DESC"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-20 bg-input-surface font-mono text-meta md:text-meta"
      />
      <p className="text-[11.5px] leading-relaxed text-text-subtle">
        Narrows the projects picked, if any. Open/Closed is added by the Issues tab; an ORDER BY
        here replaces newest first.
      </p>
    </div>
  );
};

const withSaved = (projects: JiraProjectSummary[], saved: string[]): JiraProjectSummary[] => [
  ...projects,
  ...saved
    .filter((key) => !projects.some((project) => project.key === key))
    .map((key) => ({ key, name: key })),
];

const matching = (projects: JiraProjectSummary[], query: string): JiraProjectSummary[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return projects;
  return projects.filter(
    (project) =>
      project.key.toLowerCase().includes(needle) || project.name.toLowerCase().includes(needle),
  );
};
