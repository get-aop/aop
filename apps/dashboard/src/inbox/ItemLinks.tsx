import { type InboxItem, type InboxLink, IssueSourceSchema, THREAD_STATUSES } from "@aop/common";
import { GitPullRequestIcon, LinkIcon, MessageSquareIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { setLinkPostBack, unlinkInboxItem } from "../api/inbox";
import { requestConfirmation } from "../components/ConfirmationHost";
import { SourceMark } from "../projects/issues/source-marks";
import { THREAD_STATUS_LABEL } from "../projects/selectors";
import { ThreadStatusDot } from "../projects/ThreadStatusDot";
import { Link, threadPath } from "../shell/router";

/**
 * What an item is linked to in AOP: threads (with their status, and the PR notes switch for one
 * dispatched with them), pull requests (coloured by state) and issues (with their source's
 * mark). Links are AOP's own notes: removing one posts nothing anywhere.
 */
export const ItemLinks = ({
  item,
  onChanged,
}: {
  item: InboxItem;
  onChanged: (item: InboxItem) => void;
}) => {
  if (item.links.length === 0) return null;
  const unlink = async (link: InboxLink) => {
    try {
      onChanged(await unlinkInboxItem(item.id, link.id));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not remove the link");
    }
  };
  return (
    <ul data-testid="inbox-links" className="flex flex-wrap gap-1.5">
      {item.links.map((link) => (
        <li
          key={link.id}
          data-testid="inbox-link"
          data-kind={link.kind}
          className="flex items-center gap-1 rounded-row border border-border bg-raised py-0.5 pr-0.5 pl-2 text-[12px]"
        >
          <LinkBody link={link} />
          {link.kind === "thread" && link.postBack ? (
            <PostBackOff item={item} link={link} onChanged={onChanged} />
          ) : null}
          <button
            type="button"
            aria-label={`Remove the link to ${link.title ?? link.ref}`}
            data-testid="inbox-link-remove"
            onClick={() => void unlink(link)}
            className="grid size-5 place-items-center rounded-md text-text-subtle hover:bg-hover hover:text-text"
          >
            <XIcon className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
};

const LinkBody = ({ link }: { link: InboxLink }) => {
  if (link.kind === "thread") return <ThreadLink link={link} />;
  if (link.kind === "pull-request") return <PullRequestLink link={link} />;
  return <IssueLink link={link} />;
};

const ThreadLink = ({ link }: { link: InboxLink }) => {
  const status = THREAD_STATUSES.find((candidate) => candidate === link.status);
  return (
    <Link
      to={link.projectId ? threadPath(link.projectId, link.ref) : "#"}
      className="flex items-center gap-1.5 text-text hover:underline"
      title={status ? THREAD_STATUS_LABEL[status] : "Thread"}
    >
      {status ? <ThreadStatusDot status={status} /> : <MessageSquareIcon className="size-3" />}
      Thread · {link.title ?? link.ref}
    </Link>
  );
};

const PR_TONE: Record<string, string> = { merged: "text-merged", open: "text-ok" };

const PullRequestLink = ({ link }: { link: InboxLink }) => (
  <a
    href={link.url ?? undefined}
    target="_blank"
    rel="noreferrer noopener"
    data-state={link.status ?? undefined}
    className={cn(
      "flex items-center gap-1 hover:underline",
      PR_TONE[link.status ?? ""] ?? "text-text",
    )}
  >
    <GitPullRequestIcon className="size-3" />
    {link.ref}
    {link.status ? <span className="text-text-subtle">· {link.status}</span> : null}
  </a>
);

const IssueLink = ({ link }: { link: InboxLink }) => {
  const source = IssueSourceSchema.safeParse(link.ref.split(":")[0]);
  const label = source.success ? link.ref.slice(link.ref.indexOf(":") + 1) : link.ref;
  return (
    <a
      href={link.url ?? undefined}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center gap-1 text-text hover:underline"
    >
      {source.success ? (
        <SourceMark source={source.data} className="size-3" />
      ) : (
        <LinkIcon className="size-3" />
      )}
      {label}
      {link.title ? <span className="max-w-48 truncate text-text-subtle">{link.title}</span> : null}
    </a>
  );
};

/** The post-back is on for this thread: one click (with a confirmation) turns it off. */
const PostBackOff = ({
  item,
  link,
  onChanged,
}: {
  item: InboxItem;
  link: InboxLink;
  onChanged: (item: InboxItem) => void;
}) => (
  <button
    type="button"
    data-testid="inbox-postback-off"
    title="AOP posts this thread's PR notes in the Slack thread, as you. Click to stop."
    onClick={async () => {
      const confirmed = await requestConfirmation({
        title: "Stop the PR notes?",
        message:
          "AOP will no longer post in the Slack thread when this thread opens or merges a pull request.",
        confirmLabel: "Stop posting",
      });
      if (confirmed) onChanged(await setLinkPostBack(item.id, link.id, false));
    }}
    className="rounded-md px-1 text-[11px] text-text-muted hover:bg-hover hover:text-text"
  >
    Posts PR notes
  </button>
);
