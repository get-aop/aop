import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { ReleaseNotesLink } from "./ReleaseNotesLink";
import { runUpdateAction } from "./update-actions";
import type { UpdateRowView } from "./update-rows";
import { useUpdates } from "./update-store";

const TONE: Record<UpdateRowView["tone"], string> = {
  quiet: "text-text-subtle",
  news: "text-running",
  busy: "text-text",
  ok: "text-ok",
  bad: "text-blocked",
};

/** One update row: This app, Host <name>, or an agent CLI. The popover and the Updates page share it. */
export const UpdateRow = ({ row, compact = false }: { row: UpdateRowView; compact?: boolean }) => {
  const { sending } = useUpdates();
  return (
    <div
      data-testid={`update-row-${row.id}`}
      data-status={row.status}
      className={cn("flex flex-col gap-1", compact ? "px-3 py-2.5" : "")}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-[13px] font-medium text-text">{row.title}</span>
        <span
          data-testid="update-row-status"
          className={cn("ml-auto flex shrink-0 items-center gap-1.5 text-[11.5px]", TONE[row.tone])}
        >
          {row.tone === "busy" ? <Spinner className="size-3" /> : null}
          {row.status}
        </span>
      </div>
      <p className="text-[11.5px] text-text-subtle">
        <span data-testid="update-row-meta">{row.meta}</span>
        {row.link ? (
          <>
            {" · "}
            <ReleaseNotesLink url={row.link.url} testId={`update-row-link-${row.id}`}>
              {row.link.label}
            </ReleaseNotesLink>
          </>
        ) : null}
      </p>
      {row.note ? (
        <p data-testid="update-row-note" className="text-[12px] leading-relaxed text-text-muted">
          {row.note}
        </p>
      ) : null}
      {row.blocked ? (
        <p data-testid="update-row-blocked" className="text-[12px] leading-relaxed text-waiting">
          {row.blocked}
        </p>
      ) : null}
      {row.actions.length > 0 ? (
        <div className="mt-1 flex flex-wrap justify-end gap-1.5">
          {row.actions.map((action, index) => (
            <Button
              key={action.kind}
              type="button"
              size="xs"
              variant={index === 0 ? "secondary" : "ghost"}
              data-testid={`update-action-${action.kind}`}
              disabled={sending}
              onClick={() => void runUpdateAction(action)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
