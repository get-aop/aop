const RADIUS = 7.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The n/m progress of a thread's checklist: a ring that fills clockwise, with the fraction beside it. */
export const StepsRing = ({ done, total }: { done: number; total: number }) => {
  const filled = total === 0 ? 0 : Math.min(done, total) / total;
  return (
    <span
      data-testid="thread-steps"
      data-done={done}
      data-total={total}
      title={`${done} of ${total} steps done`}
      className="inline-flex items-center gap-1.5 text-meta tabular-nums text-text-muted"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="-rotate-90">
        <circle
          cx="10"
          cy="10"
          r={RADIUS}
          fill="none"
          strokeWidth="2.5"
          className="stroke-border-strong"
        />
        <circle
          cx="10"
          cy="10"
          r={RADIUS}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE * filled} ${CIRCUMFERENCE}`}
          className={done >= total ? "stroke-ok" : "stroke-running"}
        />
      </svg>
      <span>
        {done}/{total}
      </span>
    </span>
  );
};
