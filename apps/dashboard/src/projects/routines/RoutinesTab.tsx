import type { Project, Routine } from "@aop/common";
import { ClockIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { deleteRoutine, runRoutineNow, updateRoutine } from "../../api/routines";
import { useIsHostOwner } from "../../settings/use-host-owner";
import { useNow } from "../use-now";
import { type RoutineActions, RoutineCard } from "./RoutineCard";
import { RoutineFormDialog, type RoutineFormMode } from "./RoutineForm";
import { draftFromRoutine, duplicateDraft, emptyDraft } from "./routine-draft";
import { type RoutinesState, useRoutines } from "./use-routines";

// The countdown reads in seconds under a minute, so it ticks every second.
const COUNTDOWN_TICK_MS = 1_000;

/** The Routines tab: the project's work on a schedule, made by hand here or by asking the coordinator. */
export const RoutinesTab = ({ project }: { project: Project }) => {
  const state = useRoutines(project.id);
  const owner = useIsHostOwner(true);
  const now = useNow(COUNTDOWN_TICK_MS);
  const [form, setForm] = useState<RoutineFormMode | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Every action answers with the routine as the host now has it; a refusal says why.
  const act = async (routine: Routine, run: () => Promise<Routine | null>) => {
    setBusyId(routine.id);
    setNotice(null);
    try {
      const changed = await run();
      if (changed) state.put(changed);
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusyId(null);
    }
  };

  const actions: RoutineActions = {
    toggle: (routine, enabled) =>
      void act(routine, () => updateRoutine(project.id, routine.id, { enabled })),
    runNow: (routine) =>
      void act(routine, async () => {
        const ran = await runRoutineNow(project.id, routine.id);
        setOpenId(routine.id);
        return ran.routine;
      }),
    edit: (routine) => setForm({ kind: "edit", routine, draft: draftFromRoutine(routine) }),
    duplicate: (routine) =>
      setForm({ kind: "create", draft: duplicateDraft(routine), title: "Duplicate routine" }),
    remove: (routine) => setDeleting(routine),
  };

  const newRoutine = () =>
    setForm({
      kind: "create",
      draft: emptyDraft(project.repoIds.length === 1 ? (project.repoIds[0] ?? null) : null),
      title: "New routine",
    });

  const routines = state.routines;
  const readOnly = !owner && routines !== null && routines.length > 0;
  return (
    <div data-testid="routines-tab" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <p className="min-w-0 flex-1 truncate text-meta text-text-subtle">
          {state.timeZone ? `Times are the host's, ${state.timeZone}` : ""}
        </p>
        {owner ? (
          <Button size="sm" variant="secondary" data-testid="routine-new" onClick={newRoutine}>
            <PlusIcon /> New routine
          </Button>
        ) : null}
      </div>
      {notice ? <Notice text={notice} onDismiss={() => setNotice(null)} /> : null}
      {readOnly ? (
        <p data-testid="routines-read-only" className="px-3 pb-2 text-meta text-text-subtle">
          Only the host owner can change routines, on the host's own dashboard.
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <RoutineListBody
          state={state}
          owner={owner}
          now={now}
          openId={openId}
          setOpenId={setOpenId}
          busyId={busyId}
          actions={actions}
          onNew={newRoutine}
        />
      </div>
      <RoutineFormDialog
        project={project}
        mode={form}
        limits={state.limits}
        onClose={() => setForm(null)}
        onSaved={(routine) => {
          state.put(routine);
          setForm(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this routine?"
        message={`"${deleting?.name ?? ""}" stops running and its history is removed. Threads it started stay.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const routine = deleting;
          setDeleting(null);
          if (!routine) return;
          void act(routine, async () => {
            await deleteRoutine(project.id, routine.id);
            state.drop(routine.id);
            return null;
          });
        }}
      />
    </div>
  );
};

const RoutineListBody = ({
  state,
  owner,
  now,
  openId,
  setOpenId,
  busyId,
  actions,
  onNew,
}: {
  state: RoutinesState;
  owner: boolean;
  now: number;
  openId: string | null;
  setOpenId: (update: (id: string | null) => string | null) => void;
  busyId: string | null;
  actions: RoutineActions;
  onNew: () => void;
}) => {
  const { routines } = state;
  if (routines === null) {
    return state.error ? (
      <p role="alert" className="py-6 text-center text-meta text-blocked">
        Could not load routines: {state.error}
      </p>
    ) : null;
  }
  if (routines.length === 0) return <EmptyRoutines owner={owner} onNew={onNew} />;
  return (
    <ul data-testid="routine-list" className="flex flex-col gap-2">
      {routines.map((routine) => (
        <RoutineCard
          key={routine.id}
          routine={routine}
          now={now}
          timeZone={state.timeZone}
          open={openId === routine.id}
          onToggleOpen={() => setOpenId((id) => (id === routine.id ? null : routine.id))}
          canEdit={owner}
          busy={busyId === routine.id}
          actions={actions}
        />
      ))}
    </ul>
  );
};

const EmptyRoutines = ({ owner, onNew }: { owner: boolean; onNew: () => void }) => (
  <div
    data-testid="routines-empty"
    className="flex flex-col items-center gap-3 px-4 py-16 text-center"
  >
    <ClockIcon aria-hidden="true" className="size-5 text-text-muted" />
    <p className="max-w-80 text-body text-text-muted">
      Ask Claude in the chat to put recurring work on a schedule, like a morning digest or a weekly
      report.
    </p>
    {owner ? (
      <Button size="sm" variant="outline" onClick={onNew} data-testid="routine-new-empty">
        <PlusIcon /> Or set one up by hand
      </Button>
    ) : null}
  </div>
);

const Notice = ({ text, onDismiss }: { text: string; onDismiss: () => void }) => (
  <div
    role="alert"
    data-testid="routines-notice"
    className="mx-3 mb-2 flex items-start gap-2 rounded-md border border-blocked/30 bg-blocked/10 px-3 py-2 text-meta text-blocked"
  >
    <p className="min-w-0 flex-1">{text}</p>
    <button type="button" aria-label="Dismiss" onClick={onDismiss} className="shrink-0">
      <XIcon className="size-3.5" />
    </button>
  </div>
);
