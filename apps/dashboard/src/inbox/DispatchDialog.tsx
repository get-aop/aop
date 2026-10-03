import type { InboxDispatchDraft, InboxDispatchInput, InboxItem } from "@aop/common";
import { useEffect, useState } from "react";
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
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import { dispatchFromInbox, getDispatchDraft } from "../api/inbox";
import { requestConfirmation } from "../components/ConfirmationHost";
import { useProjectsState } from "../projects/ProjectsProvider";
import { useRegisteredRepos } from "../projects/use-registered-repos";
import { navigate, threadPath } from "../shell/router";
import { ChoiceSelect } from "./ChoiceSelect";
import { LabeledField, TickRow } from "./fields";

/**
 * Dispatch a thread from an item: the project (preselected when the channel is mapped), a thread
 * in one of its repositories or a message to its coordinator, and the brief, which the person
 * edits freely. The parts they leave ticked are added below it. Only that thread sees the
 * Slack text; it gets no Slack tool. The PR notes are off unless the person confirms the exact
 * text they would post.
 */
export const DispatchDialog = ({
  item,
  projectFilter,
  onClose,
  onDispatched,
}: {
  item: InboxItem;
  projectFilter: string | null;
  onClose: () => void;
  onDispatched: (item: InboxItem) => void;
}) => {
  const [draft, setDraft] = useState<InboxDispatchDraft | null>(null);
  const [form, setForm] = useState<DispatchForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const active = Object.values(useProjectsState().byId).filter(
    (entry) => entry.project.status === "active",
  );
  // With one project there is nothing to choose; a mapped channel or the filter wins otherwise.
  const onlyProject = active.length === 1 ? (active[0]?.project.id ?? null) : null;

  useEffect(() => {
    void getDispatchDraft(item.id).then(
      (loaded) => {
        setDraft(loaded);
        setForm(initialForm(loaded, item, projectFilter ?? onlyProject));
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [item, projectFilter, onlyProject]);

  const start = async () => {
    const input = form ? toInput(form) : null;
    if (!input) return;
    setStarting(true);
    try {
      const result = await dispatchFromInbox(item.id, input);
      onDispatched(result.item);
      announce(input.projectId, result.threadId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        data-testid="inbox-dispatch"
        className="max-h-[90vh] w-[min(620px,calc(100vw-2rem))] overflow-y-auto"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-[15px]">Dispatch a thread</DialogTitle>
            <DialogDescription>
              The thread gets this brief only. It cannot read the Inbox or post to Slack.
            </DialogDescription>
          </DialogHeader>
          {form && draft ? (
            <DispatchFields item={item} draft={draft} form={form} onChange={setForm} />
          ) : (
            <p className="text-[13px] text-text-subtle">{error ? null : "Preparing the brief…"}</p>
          )}
          {error ? (
            <p
              role="alert"
              data-testid="inbox-dispatch-error"
              className="text-[12.5px] text-blocked"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="inbox-dispatch-start"
              disabled={!ready(form) || starting}
            >
              {startLabel(form, starting)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

interface DispatchForm {
  projectId: string | null;
  mode: "thread" | "coordinator";
  repoId: string | null;
  title: string;
  brief: string;
  includeContext: boolean;
  issueLinkId: string | null;
  attachLink: boolean;
  postBack: boolean;
}

const initialForm = (
  draft: InboxDispatchDraft,
  item: InboxItem,
  projectFilter: string | null,
): DispatchForm => ({
  projectId: draft.projectId ?? projectFilter,
  mode: "thread",
  repoId: null,
  title: draft.title,
  brief: draft.brief,
  includeContext: draft.contextLength > 0,
  issueLinkId: item.links.find((link) => link.kind === "issue")?.id ?? null,
  attachLink: item.permalink !== null,
  postBack: false,
});

const toInput = (form: DispatchForm): InboxDispatchInput | null =>
  form.projectId
    ? {
        projectId: form.projectId,
        mode: form.mode,
        repoId: form.mode === "thread" ? form.repoId : null,
        title: form.title,
        brief: form.brief,
        includeContext: form.includeContext,
        issueLinkId: form.issueLinkId,
        attachLink: form.attachLink,
        postBack: form.mode === "thread" && form.postBack,
      }
    : null;

const ready = (form: DispatchForm | null): boolean =>
  Boolean(form?.projectId && form.title.trim() && form.brief.trim());

const startLabel = (form: DispatchForm | null, starting: boolean): string => {
  if (starting) return "Starting…";
  return form?.mode === "coordinator" ? "Send to the coordinator" : "Start thread";
};

const announce = (projectId: string, threadId: string | null) => {
  if (!threadId) {
    toast.success("Sent to the coordinator");
    return;
  }
  toast.success("Thread started", {
    action: { label: "Open", onClick: () => navigate(threadPath(projectId, threadId)) },
  });
};

const DispatchFields = ({
  item,
  draft,
  form,
  onChange,
}: {
  item: InboxItem;
  draft: InboxDispatchDraft;
  form: DispatchForm;
  onChange: (form: DispatchForm) => void;
}) => {
  const set = (patch: Partial<DispatchForm>) => onChange({ ...form, ...patch });
  const issue = item.links.find((link) => link.kind === "issue");
  return (
    <div className="flex flex-col gap-3">
      <ProjectAndRepo form={form} set={set} />
      <LabeledField label="Title">
        {(id) => (
          <Input
            id={id}
            data-testid="inbox-dispatch-title"
            value={form.title}
            onChange={(event) => set({ title: event.target.value })}
          />
        )}
      </LabeledField>
      <LabeledField label="Brief (edit freely; with the parts ticked below, this is everything the thread sees)">
        {(id) => (
          <Textarea
            id={id}
            data-testid="inbox-dispatch-brief"
            value={form.brief}
            rows={8}
            onChange={(event) => set({ brief: event.target.value })}
            className="max-h-72 text-[12.5px]"
          />
        )}
      </LabeledField>
      <div className="flex flex-col gap-2">
        {draft.contextLength > 0 ? (
          <TickRow
            testId="inbox-dispatch-context"
            checked={form.includeContext}
            onChange={(includeContext) => set({ includeContext })}
          >
            Include the thread context ({formatLength(draft.contextLength)})
          </TickRow>
        ) : null}
        {issue ? (
          <TickRow
            testId="inbox-dispatch-issue"
            checked={form.issueLinkId !== null}
            onChange={(on) => set({ issueLinkId: on ? issue.id : null })}
          >
            Include the linked issue {issue.title ?? issue.ref} (title, link and description,
            quoted)
          </TickRow>
        ) : null}
        {item.permalink ? (
          <TickRow
            testId="inbox-dispatch-link"
            checked={form.attachLink}
            onChange={(attachLink) => set({ attachLink })}
          >
            Attach the Slack link
          </TickRow>
        ) : null}
        {form.mode === "thread" && item.permalink ? (
          <TickRow
            testId="inbox-dispatch-postback"
            checked={form.postBack}
            onChange={(on) =>
              void confirmPostBack(on, previewFor(draft, form.title)).then((postBack) =>
                set({ postBack }),
              )
            }
          >
            Post a note in the Slack thread when this thread opens or merges a PR (off by default)
          </TickRow>
        ) : null}
      </div>
    </div>
  );
};

/** Turning the PR notes on asks once per dispatch, with the exact text they post. */
/** The notes as they will read: with the title the person gave the thread, not the draft's. */
const previewFor = (draft: InboxDispatchDraft, title: string): string[] =>
  draft.postBackPreview.map((note) => note.replace(draft.title, title.trim() || draft.title));

const confirmPostBack = async (on: boolean, preview: string[]): Promise<boolean> => {
  if (!on) return false;
  return requestConfirmation({
    title: "Post to Slack as you?",
    message: `When this thread opens or merges a pull request, AOP will reply in the Slack thread as you:\n\n${preview.join("\n")}\n\nThe host posts these two fixed notes itself. The thread never gets a Slack tool, and you can turn this off on the item at any time.`,
    confirmLabel: "Post these notes",
    cancelLabel: "Keep off",
    large: true,
  });
};

const ProjectAndRepo = ({
  form,
  set,
}: {
  form: DispatchForm;
  set: (patch: Partial<DispatchForm>) => void;
}) => {
  const projects = Object.values(useProjectsState().byId)
    .map((entry) => entry.project)
    .filter((project) => project.status === "active");
  const repos = useRegisteredRepos() ?? [];
  // With one repository the host picks it; the choice shows only when there are several.
  const project = projects.find((candidate) => candidate.id === form.projectId);
  const repoOptions = (project?.repoIds ?? []).map((id) => ({
    value: id,
    label: repos.find((repo) => repo.id === id)?.name ?? id,
  }));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ChoiceSelect
        testId="inbox-dispatch-project"
        label="Project"
        value={form.projectId}
        options={projects.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
        onChange={(projectId) => set({ projectId, repoId: null })}
        className="w-44"
      />
      <ChoiceSelect
        testId="inbox-dispatch-mode"
        label="Start as"
        value={form.mode}
        options={[
          { value: "thread", label: "A thread" },
          { value: "coordinator", label: "Ask the coordinator" },
        ]}
        onChange={(mode) => set({ mode: mode === "coordinator" ? "coordinator" : "thread" })}
        className="w-44"
      />
      {form.mode === "thread" && repoOptions.length > 1 ? (
        <ChoiceSelect
          testId="inbox-dispatch-repo"
          label="Repository"
          value={form.repoId}
          options={repoOptions}
          onChange={(repoId) => set({ repoId })}
          className="w-44"
        />
      ) : null}
    </div>
  );
};

const formatLength = (characters: number): string =>
  characters >= 1000 ? `${(characters / 1000).toFixed(1)}k characters` : `${characters} characters`;
