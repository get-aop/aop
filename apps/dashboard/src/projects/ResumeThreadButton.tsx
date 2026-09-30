import type { Thread } from "@aop/common";
import { RotateCcwIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { threadActions } from "./thread-actions";

/**
 * Ends a rate-limited thread's wait now. It draws nothing for a thread in any other status,
 * so a card can hold it unconditionally. It sits above the card's link (`z-10`) and opens nothing.
 */
export const ResumeThreadButton = ({
  thread,
  className,
}: {
  thread: Thread;
  className?: string;
}) =>
  thread.status === "rate-limited" ? (
    <Button
      type="button"
      size="xs"
      variant="outline"
      data-testid="thread-card-resume"
      className={cn("relative z-10", className)}
      onClick={() => void threadActions.resume(thread)}
    >
      <RotateCcwIcon />
      Resume now
    </Button>
  ) : null;
