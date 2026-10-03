import { InboxIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { iconButtonClass } from "../components/IconButton";
import { inboxPath, Link, useRoute } from "../shell/router";
import { useInboxSummary } from "./inbox-summary-store";

/**
 * The Inbox in every top bar, first of the host-wide group: the Inbox is about the person, not
 * one project. Hidden until a source is connected. The count is white, not the orange that
 * means an agent waits on the person.
 */
export const InboxButton = () => {
  const summary = useInboxSummary();
  const route = useRoute();
  if (!summary?.connected) return null;
  const { unread } = summary;
  const label = unread === 0 ? "Inbox" : `Inbox, ${unread} unread`;
  return (
    <Link
      to={inboxPath()}
      data-testid="inbox-button"
      aria-label={label}
      title={label}
      className={cn(iconButtonClass(route.name === "inbox"), "flex w-auto min-w-8 gap-1 px-1.5")}
    >
      <InboxIcon />
      {unread > 0 ? (
        <span
          data-testid="inbox-unread"
          className="min-w-4 rounded-full bg-text px-1 text-center text-[11px] leading-4 font-semibold text-canvas"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
};
