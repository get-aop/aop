import type { ReviewNote } from "../api/specs-client";

interface PlanNotesRailProps {
  notes: ReviewNote[];
  pendingNoteCount: number;
  submitting: boolean;
  onDeleteNote: (noteId: string) => Promise<void>;
  onSubmitCorrections: () => void;
}

/**
 * The right-hand "Review notes" rail of the Plan tab, ported verbatim from the
 * AOP Studio design concept (notes rail, mockup line 388-422). Notes are created
 * from the plain text selection in the plan column; this rail collects them, lets
 * the operator remove one, and submits the whole batch as a single correction
 * round. Nothing executes here — submitting only asks the worker to redraft.
 */
export const PlanNotesRail = ({
  notes,
  pendingNoteCount,
  submitting,
  onDeleteNote,
  onSubmitCorrections,
}: PlanNotesRailProps) => (
  <aside
    data-testid="plan-notes-rail"
    style={{
      width: "340px",
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      background: "color-mix(in srgb,var(--color-surface) 60%,var(--color-canvas)",
      borderLeft: "1px solid var(--color-border)",
      minHeight: 0,
    }}
  >
    <RailHeader count={notes.length} />

    <div
      className="aop-scroll"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: "11px",
      }}
    >
      {notes.length === 0 ? (
        <EmptyNotes />
      ) : (
        notes.map((note) => <NoteCard key={note.id} note={note} onDelete={onDeleteNote} />)
      )}
    </div>

    {pendingNoteCount > 0 ? (
      <SubmitFooter
        count={pendingNoteCount}
        submitting={submitting}
        onSubmit={onSubmitCorrections}
      />
    ) : null}
  </aside>
);

const RailHeader = ({ count }: { count: number }) => (
  <div
    style={{
      padding: "18px 20px 14px",
      borderBottom: "1px solid var(--color-border)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-favorite)"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600 }}>
        Review notes
      </span>
    </div>
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--color-text-subtle)",
        background: "color-mix(in srgb,var(--color-text-subtle) 12%,transparent)",
        borderRadius: "6px",
        padding: "2px 8px",
      }}
    >
      {count}
    </span>
  </div>
);

const EmptyNotes = () => (
  <div
    data-testid="plan-notes-empty"
    style={{ marginTop: "30px", textAlign: "center", padding: "0 10px" }}
  >
    <div
      style={{
        width: "46px",
        height: "46px",
        borderRadius: "13px",
        margin: "0 auto",
        display: "grid",
        placeItems: "center",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text-subtle)",
      }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    </div>
    <div
      style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, marginTop: "13px" }}
    >
      No notes yet
    </div>
    <div
      style={{
        fontSize: "12.5px",
        color: "var(--color-text-subtle)",
        marginTop: "5px",
        lineHeight: 1.5,
      }}
    >
      Select any line in the plan to leave a correction for the next draft.
    </div>
  </div>
);

const NoteCard = ({
  note,
  onDelete,
}: {
  note: ReviewNote;
  onDelete: (noteId: string) => Promise<void>;
}) => (
  <div
    data-testid={`plan-note-${note.id}`}
    style={{
      background: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      borderRadius: "12px",
      padding: "12px 13px",
      animation: "aop-in .16s ease",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        borderLeft: "2px solid var(--color-favorite)",
        paddingLeft: "9px",
      }}
    >
      <span
        style={{
          fontSize: "12px",
          color: "var(--color-text-muted)",
          lineHeight: 1.45,
          fontStyle: "italic",
        }}
      >
        “{note.selectedText}”
      </span>
    </div>
    <p style={{ margin: "9px 0 0", fontSize: "13px", lineHeight: 1.5, color: "var(--color-text)" }}>
      {note.note}
    </p>
    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "9px" }}>
      {note.submittedAt ? (
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--color-text-subtle)",
          }}
        >
          Submitted
        </span>
      ) : (
        <button
          type="button"
          onClick={() => void onDelete(note.id)}
          className="focus-ring"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-blocked)",
            fontFamily: "var(--font-sans)",
            fontSize: 11.5,
            fontWeight: 600,
            cursor: "pointer",
            padding: 0,
          }}
        >
          Remove
        </button>
      )}
    </div>
  </div>
);

const SubmitFooter = ({
  count,
  submitting,
  onSubmit,
}: {
  count: number;
  submitting: boolean;
  onSubmit: () => void;
}) => (
  <div style={{ padding: "14px 18px", borderTop: "1px solid var(--color-border)" }}>
    <button
      type="button"
      onClick={onSubmit}
      disabled={submitting}
      data-testid="submit-corrections-button"
      className="focus-ring"
      style={{
        width: "100%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        background: "var(--color-primary)",
        color: "var(--color-primary-foreground)",
        border: "none",
        borderRadius: "11px",
        padding: "12px",
        fontFamily: "var(--font-sans)",
        fontSize: 13.5,
        fontWeight: 600,
        cursor: submitting ? "not-allowed" : "pointer",
        opacity: submitting ? 0.5 : 1,
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M21 2l-7 20-4-9-9-4z" />
      </svg>
      {submitting ? "Submitting..." : `Submit ${count} → regenerate plan`}
    </button>
    <p
      style={{
        margin: "8px 0 0",
        textAlign: "center",
        fontSize: "11.5px",
        color: "var(--color-text-subtle)",
      }}
    >
      The worker redrafts the plan with your notes. Nothing runs yet.
    </p>
  </div>
);
