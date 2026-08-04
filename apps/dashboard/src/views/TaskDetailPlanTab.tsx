import type { ReviewNote } from "../api/specs-client";
import { PlanNotesRail } from "../components/PlanNotesRail";
import { SpecsTab } from "../components/SpecsTab";
import type { Task } from "../types";

interface TaskDetailPlanTabProps {
  task: Task;
  initialFilePath?: string;
  notes: ReviewNote[];
  pendingNoteCount: number;
  submitting: boolean;
  onCreateNote: (input: {
    filePath: string;
    selectedText: string;
    textOccurrence?: number;
    note: string;
  }) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onUpdateNote: (noteId: string, noteText: string) => Promise<void>;
  onSubmitCorrections: () => void;
}

/**
 * Plan tab, ported verbatim from the AOP Studio design concept (mockup line
 * 356-423): a centered plan.md reading column on the left (the SpecsTab, with its
 * existing select-to-annotate flow) inside a 30px 36px 120px scroll well capped at
 * 640px, and a fixed Review notes rail on the right that collects the notes and
 * submits the correction round.
 */
export const TaskDetailPlanTab = ({
  task,
  initialFilePath,
  notes,
  pendingNoteCount,
  submitting,
  onCreateNote,
  onDeleteNote,
  onUpdateNote,
  onSubmitCorrections,
}: TaskDetailPlanTabProps) => (
  <div style={{ flex: 1, display: "flex", minHeight: 0 }} data-testid="task-plan-tab">
    <div
      className="aop-scroll min-h-0 flex-1 overflow-auto"
      style={{ minWidth: 0, padding: "30px 36px 120px" }}
    >
      <div style={{ maxWidth: "640px", margin: "0 auto" }}>
        <SpecsTab
          task={task}
          initialFilePath={initialFilePath}
          notes={notes}
          onCreateNote={onCreateNote}
          onDeleteNote={onDeleteNote}
          onUpdateNote={onUpdateNote}
        />
      </div>
    </div>

    <PlanNotesRail
      notes={notes}
      pendingNoteCount={pendingNoteCount}
      submitting={submitting}
      onDeleteNote={onDeleteNote}
      onSubmitCorrections={onSubmitCorrections}
    />
  </div>
);
