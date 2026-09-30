import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { useLiveProjects } from "./ProjectsProvider";

/**
 * Why a project's threads could not be fetched, in the host's words, and a way to fetch them
 * again now. The page keeps retrying by itself too, so this goes away once the host answers.
 */
export const ThreadsLoadError = ({
  projectId,
  subject,
  error,
  className,
}: {
  projectId: string;
  /** What did not load, as the sentence names it: "this project's threads", "this thread". */
  subject: string;
  error: string;
  className?: string;
}) => {
  const live = useLiveProjects();
  return (
    <div
      data-testid="threads-error"
      role="alert"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}
    >
      <p data-testid="threads-error-message" className="text-text-muted">
        Could not load {subject}: {error}
      </p>
      <Button
        type="button"
        size="xs"
        variant="outline"
        data-testid="threads-retry"
        onClick={() => void live.refetch(projectId)}
      >
        Try again
      </Button>
    </div>
  );
};
