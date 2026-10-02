import {
  getRuntimeModelOptions,
  getThinkingOptions,
  type Project,
  type Routine,
  type RoutineLimits,
  type RoutineScheduleKind,
  type SchedulePreview,
} from "@aop/common";
import { type FormEvent, useEffect, useState } from "react";
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
import { Label } from "@/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";
import { Textarea } from "@/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { createRoutine, previewSchedule, updateRoutine } from "../../api/routines";
import { useRegisteredRepos } from "../use-registered-repos";
import {
  draftProblems,
  draftSchedule,
  draftToInput,
  type RoutineDraft,
  SCHEDULE_KIND_LABEL,
  scheduleIsValid,
  WEEKDAY_SHORT,
} from "./routine-draft";
import { formatRunTime } from "./routine-format";

/** What the form is for: a new routine (from scratch or a copy), or changing one. */
export type RoutineFormMode =
  | { kind: "create"; draft: RoutineDraft; title: string }
  | { kind: "edit"; routine: Routine; draft: RoutineDraft };

const USE_DEFAULT = "__default";
const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
const PREVIEW_DELAY_MS = 250;

export const RoutineFormDialog = ({
  project,
  mode,
  limits,
  onClose,
  onSaved,
}: {
  project: Project;
  mode: RoutineFormMode | null;
  limits: RoutineLimits | null;
  onClose: () => void;
  onSaved: (routine: Routine) => void;
}) => (
  <Dialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
    <DialogContent
      data-testid="routine-form"
      className="w-[560px] max-w-[min(560px,calc(100%-1.5rem))] max-h-[calc(100dvh-1.5rem)] overflow-y-auto grid-cols-[minmax(0,1fr)] gap-4"
    >
      {mode ? (
        <>
          <DialogHeader>
            <DialogTitle>{mode.kind === "edit" ? "Edit routine" : mode.title}</DialogTitle>
            <DialogDescription>
              Work this project does on a schedule. Each run starts a new thread with the brief, or
              sends it to the coordinator.
            </DialogDescription>
          </DialogHeader>
          {/* Keyed so every open starts from its own draft. */}
          <RoutineForm
            key={mode.kind === "edit" ? mode.routine.id : mode.title}
            project={project}
            mode={mode}
            limits={limits}
            onCancel={onClose}
            onSaved={onSaved}
          />
        </>
      ) : null}
    </DialogContent>
  </Dialog>
);

const RoutineForm = ({
  project,
  mode,
  limits,
  onCancel,
  onSaved,
}: {
  project: Project;
  mode: RoutineFormMode;
  limits: RoutineLimits | null;
  onCancel: () => void;
  onSaved: (routine: Routine) => void;
}) => {
  const [draft, setDraft] = useState<RoutineDraft>(mode.draft);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useSchedulePreview(project.id, draft);
  const set = (patch: Partial<RoutineDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const problems = draftProblems(draft);
  const shown = attempted ? problems : {};
  const blocked = Object.keys(problems).length > 0 || Boolean(preview?.problem);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    try {
      const input = draftToInput(draft);
      const saved =
        mode.kind === "edit"
          ? await updateRoutine(project.id, mode.routine.id, input)
          : await createRoutine(project.id, input);
      onSaved(saved);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-4" noValidate>
      <FormField label="Name" htmlFor="routine-name" problem={shown.name}>
        <Input
          id="routine-name"
          data-testid="routine-name"
          value={draft.name}
          maxLength={120}
          placeholder="Morning digest"
          aria-invalid={Boolean(shown.name)}
          onChange={(event) => set({ name: event.target.value })}
        />
      </FormField>
      <FormField label="What it does" htmlFor="routine-prompt" problem={shown.prompt}>
        <Textarea
          id="routine-prompt"
          data-testid="routine-prompt"
          value={draft.prompt}
          rows={4}
          maxLength={8000}
          placeholder="Summarize the issues and pull requests opened since yesterday, and flag anything blocking."
          aria-invalid={Boolean(shown.prompt)}
          onChange={(event) => set({ prompt: event.target.value })}
        />
        <p className="text-meta text-text-subtle">
          Each run gets this brief and nothing else, so say what to look at and what to produce.
        </p>
      </FormField>
      <ScheduleFields draft={draft} set={set} problem={shown.schedule} />
      <PreviewLine preview={preview} limits={limits} />
      <TargetFields project={project} draft={draft} set={set} />
      <FormField label="Runs missed while the host was off" htmlFor="routine-catch-up">
        <Select
          value={draft.catchUp}
          onValueChange={(value) => set({ catchUp: value === "run-once" ? "run-once" : "skip" })}
        >
          <SelectTrigger id="routine-catch-up" data-testid="routine-catch-up" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="skip">Skip them and note them as missed</SelectItem>
            <SelectItem value="run-once">Run once when the host is back</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <div className="flex items-center gap-3">
        <Switch
          id="routine-enabled"
          data-testid="routine-enabled"
          checked={draft.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
        />
        <Label htmlFor="routine-enabled" className="text-body font-normal">
          {draft.enabled ? "On: runs on its schedule" : "Paused: saved, but does not run"}
        </Label>
      </div>
      {error ? (
        <p role="alert" data-testid="routine-form-error" className="text-meta text-blocked">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          data-testid="routine-save"
          disabled={saving || (attempted && blocked)}
        >
          {mode.kind === "edit" ? "Save" : "Create routine"}
        </Button>
      </DialogFooter>
    </form>
  );
};

const ScheduleFields = ({
  draft,
  set,
  problem,
}: {
  draft: RoutineDraft;
  set: (patch: Partial<RoutineDraft>) => void;
  problem?: string;
}) => (
  <fieldset className="flex min-w-0 flex-col gap-2">
    <legend className="mb-2 text-meta font-medium text-text-muted">When</legend>
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={draft.kind}
        onValueChange={(kind) => set({ kind: kind as RoutineScheduleKind })}
      >
        <SelectTrigger aria-label="Schedule" data-testid="routine-kind" className="min-w-40 flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SCHEDULE_KIND_LABEL) as RoutineScheduleKind[]).map((kind) => (
            <SelectItem key={kind} value={kind}>
              {SCHEDULE_KIND_LABEL[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <KindFields draft={draft} set={set} />
    </div>
    {draft.kind === "weekly" ? (
      <ToggleGroup
        type="multiple"
        variant="outline"
        aria-label="Days"
        data-testid="routine-days"
        className="flex-wrap"
        value={draft.days.map(String)}
        onValueChange={(days) => set({ days: days.map(Number) })}
      >
        {WEEKDAY_SHORT.map((label, day) => (
          <ToggleGroupItem key={label} value={String(day)} aria-label={label} className="px-2.5">
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    ) : null}
    {problem ? (
      <p data-testid="routine-schedule-problem" className="text-meta text-blocked">
        {problem}
      </p>
    ) : null}
  </fieldset>
);

const KindFields = ({
  draft,
  set,
}: {
  draft: RoutineDraft;
  set: (patch: Partial<RoutineDraft>) => void;
}) => {
  if (draft.kind === "cron") {
    return (
      <Input
        aria-label="Cron expression"
        data-testid="routine-cron"
        className="min-w-40 flex-1 font-mono"
        value={draft.expression}
        placeholder="0 9 * * 1-5"
        onChange={(event) => set({ expression: event.target.value })}
      />
    );
  }
  if (draft.kind === "hourly") {
    return (
      <>
        <Select
          value={String(draft.every)}
          onValueChange={(every) => set({ every: Number(every) })}
        >
          <SelectTrigger
            aria-label="Hours between runs"
            data-testid="routine-every"
            className="w-28"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EVERY_HOURS.map((hours) => (
              <SelectItem key={hours} value={String(hours)}>
                {hours === 1 ? "1 hour" : `${hours} hours`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={0}
          max={59}
          aria-label="Minutes past the hour"
          data-testid="routine-minute"
          className="w-20"
          value={draft.minute}
          onChange={(event) => set({ minute: clampMinute(event.target.value) })}
        />
        <span className="text-meta text-text-subtle">min past</span>
      </>
    );
  }
  return (
    <Input
      type="time"
      aria-label="Time"
      data-testid="routine-time"
      className="w-32"
      value={draft.time}
      onChange={(event) => set({ time: event.target.value })}
    />
  );
};

const PreviewLine = ({
  preview,
  limits,
}: {
  preview: SchedulePreview | null;
  limits: RoutineLimits | null;
}) => {
  if (!preview) return null;
  if (preview.problem) {
    return (
      <p data-testid="routine-preview-problem" className="-mt-2 text-meta text-blocked">
        {preview.problem}
      </p>
    );
  }
  return (
    <p data-testid="routine-preview" className="-mt-2 text-meta text-text-muted">
      {preview.description}. Next:{" "}
      {preview.nextRuns.map((run) => formatRunTime(run, preview.timeZone)).join(", ") || "never"}{" "}
      <span className="text-text-subtle">
        ({preview.timeZone}
        {limits ? `, at most every ${limits.minIntervalMinutes} min` : ""})
      </span>
    </p>
  );
};

const TargetFields = ({
  project,
  draft,
  set,
}: {
  project: Project;
  draft: RoutineDraft;
  set: (patch: Partial<RoutineDraft>) => void;
}) => {
  const repos = useRegisteredRepos();
  const provider = project.thread.provider;
  const models = getRuntimeModelOptions(provider);
  const efforts = draft.model ? getThinkingOptions(provider, draft.model) : [];
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-2 text-meta font-medium text-text-muted">Each run</legend>
      <ToggleGroup
        type="single"
        variant="outline"
        aria-label="Each run"
        data-testid="routine-target"
        value={draft.target}
        onValueChange={(target) => target && set({ target: target as RoutineDraft["target"] })}
      >
        <ToggleGroupItem value="thread" className="px-3">
          Starts a thread
        </ToggleGroupItem>
        <ToggleGroupItem value="coordinator" className="px-3">
          Messages the coordinator
        </ToggleGroupItem>
      </ToggleGroup>
      {draft.target === "thread" ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
          {project.repoIds.length > 1 ? (
            <Select value={draft.repoId ?? ""} onValueChange={(repoId) => set({ repoId })}>
              <SelectTrigger aria-label="Repository" data-testid="routine-repo" className="w-full">
                <SelectValue placeholder="Repository" />
              </SelectTrigger>
              <SelectContent>
                {project.repoIds.map((id) => (
                  <SelectItem key={id} value={id}>
                    {repos?.find((repo) => repo.id === id)?.name ?? id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Select
            value={draft.model ?? USE_DEFAULT}
            onValueChange={(model) =>
              set({ model: model === USE_DEFAULT ? null : model, effort: null })
            }
          >
            <SelectTrigger aria-label="Model" data-testid="routine-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={USE_DEFAULT}>Project's thread model</SelectItem>
              {models.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={draft.effort ?? USE_DEFAULT}
            disabled={efforts.length === 0}
            onValueChange={(effort) =>
              set({ effort: efforts.find((option) => option.value === effort)?.value ?? null })
            }
          >
            <SelectTrigger aria-label="Effort" data-testid="routine-effort" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={USE_DEFAULT}>Project's thread effort</SelectItem>
              {efforts.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </fieldset>
  );
};

const FormField = ({
  label,
  htmlFor,
  problem,
  children,
}: {
  label: string;
  htmlFor: string;
  problem?: string;
  children: React.ReactNode;
}) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <Label htmlFor={htmlFor} className="text-meta font-medium text-text-muted">
      {label}
    </Label>
    {children}
    {problem ? (
      <p data-testid={`${htmlFor}-problem`} className="text-meta text-blocked">
        {problem}
      </p>
    ) : null}
  </div>
);

/** The host's reading of the draft's schedule: words, next runs, and whether it is too frequent. */
const useSchedulePreview = (projectId: string, draft: RoutineDraft): SchedulePreview | null => {
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const valid = scheduleIsValid(draft);
  const key = JSON.stringify(valid ? draftSchedule(draft) : null);
  useEffect(() => {
    if (key === "null") {
      setPreview(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      previewSchedule(projectId, JSON.parse(key)).then(
        (next) => current && setPreview(next),
        () => current && setPreview(null),
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [projectId, key]);
  return preview;
};

const clampMinute = (value: string): number => {
  const minute = Math.trunc(Number(value));
  return Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0;
};
