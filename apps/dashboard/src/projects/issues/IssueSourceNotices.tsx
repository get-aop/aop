import type { IssueSourceStatus } from "@aop/common";
import { CircleDotIcon, CopyIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { useLocalStorage } from "../../hooks/use-local-storage";
import { formatAgo } from "../selectors";
import { GithubMark, JiraMark, LinearMark, SOURCE_NAME } from "./source-marks";

export const GH_LOGIN_COMMAND = "gh auth login";

/**
 * What stands between the tab and some of the project's issues, each with what to do about it:
 * `gh` signed out on the host, a repository that is not on GitHub, Linear's key or Jira's token
 * refused (Reconnect), a source that failed (with how old the issues shown are), and, while
 * neither tracker is connected, an invitation to connect one. The invitation can be dismissed;
 * the problems cannot.
 */
export const IssueSourceNotices = ({
  projectId,
  sources,
  owner,
  onConnectLinear,
  onConnectJira,
  onReconnectJira = onConnectJira,
}: {
  projectId: string;
  sources: readonly IssueSourceStatus[];
  owner: boolean;
  onConnectLinear: () => void;
  onConnectJira: () => void;
  /** A refused token: the dialog opens on its token step. */
  onReconnectJira?: () => void;
}) => {
  const github = sources.filter((source) => source.source === "github");
  const signedOut = github.find(
    (source) => source.status === "not-authenticated" || source.status === "gh-missing",
  );
  const offGithub = github.filter((source) => source.status === "no-github-remote");
  const failing = sources.filter((source) => source.status === "error");
  const linear = sources.find((source) => source.source === "linear");
  const jira = sources.find((source) => source.source === "jira");
  // Someone on one tracker rarely wants the other, so the invitation goes once either is there.
  const noTracker = Boolean(linear || jira) && unconnected(linear) && unconnected(jira);

  const notices = [
    signedOut ? <GithubSignedOut key="gh" source={signedOut} /> : null,
    ...failing.map((source) => <SourceFailed key={`error:${source.id}`} source={source} />),
    linear?.status === "unauthorized" ? (
      <Refused key="linear" tracker="linear" owner={owner} onConnect={onConnectLinear} />
    ) : null,
    jira?.status === "unauthorized" ? (
      <Refused key="jira" tracker="jira" owner={owner} onConnect={onReconnectJira} />
    ) : null,
    noTracker ? (
      <TrackerInvite
        key="invite"
        projectId={projectId}
        owner={owner}
        onConnectLinear={onConnectLinear}
        onConnectJira={onConnectJira}
      />
    ) : null,
    offGithub.length > 0 ? <OffGithub key="off" sources={offGithub} /> : null,
  ].filter(Boolean);

  return notices.length === 0 ? null : (
    <div data-testid="issues-notices" className="flex flex-col gap-2 px-4 pb-3">
      {notices}
    </div>
  );
};

const unconnected = (source: IssueSourceStatus | undefined): boolean =>
  !source || source.status === "not-configured";

const Notice = ({
  testId,
  tone = "neutral",
  icon,
  title,
  children,
  action,
  onDismiss,
}: {
  testId: string;
  tone?: "neutral" | "warning";
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}) => (
  <div
    data-testid={testId}
    className={cn(
      "flex items-start gap-3 rounded-card border px-3.5 py-3",
      tone === "warning" ? "border-waiting/25 bg-waiting/[0.06]" : "border-border-strong bg-raised",
    )}
  >
    <span
      className={cn(
        "mt-0.5 shrink-0 [&_svg]:size-4",
        tone === "warning" ? "text-waiting" : "text-text-muted",
      )}
    >
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-[13.5px] font-medium text-text">{title}</p>
      {children ? (
        <div className="mt-1 text-meta leading-relaxed text-text-muted">{children}</div>
      ) : null}
      {action ? <div className="mt-2.5 flex flex-wrap gap-2">{action}</div> : null}
    </div>
    {onDismiss ? (
      <button
        type="button"
        aria-label="Dismiss"
        data-testid={`${testId}-dismiss`}
        onClick={onDismiss}
        className="grid size-6 shrink-0 place-items-center rounded-row text-text-subtle hover:bg-hover hover:text-text"
      >
        <XIcon className="size-3.5" />
      </button>
    ) : null}
  </div>
);

const GithubSignedOut = ({ source }: { source: IssueSourceStatus }) => {
  const missing = source.status === "gh-missing";
  return (
    <Notice
      testId="issues-notice-github-auth"
      tone="warning"
      icon={<GithubMark />}
      title={
        missing
          ? "The GitHub CLI is not installed on the host"
          : "GitHub is not signed in on the host"
      }
      action={
        missing ? null : (
          <Button
            size="xs"
            variant="secondary"
            data-testid="issues-copy-gh-login"
            onClick={() => void copyCommand(GH_LOGIN_COMMAND)}
          >
            <CopyIcon />
            Copy <code className="font-mono">{GH_LOGIN_COMMAND}</code>
          </Button>
        )
      }
    >
      {missing ? (
        <>
          AOP lists GitHub issues through the host's <code>gh</code>. Install it from{" "}
          <a
            className="text-running hover:underline"
            href="https://cli.github.com"
            target="_blank"
            rel="noreferrer noopener"
          >
            cli.github.com
          </a>
          , sign in, then refresh.
        </>
      ) : (
        <>
          AOP reads GitHub issues with the host's <code>gh</code> login, so devices need none of
          their own. On the host machine, run <code>{GH_LOGIN_COMMAND}</code>, then refresh.
        </>
      )}
    </Notice>
  );
};

const SourceFailed = ({ source }: { source: IssueSourceStatus }) => (
  <Notice
    testId="issues-notice-error"
    tone="warning"
    icon={<TriangleAlertIcon />}
    title={`Could not read ${source.source === "github" ? source.name : SOURCE_NAME[source.source]}`}
  >
    {sentence(source.message ?? "")}
    {source.stale && source.fetchedAt
      ? ` Showing the issues read ${formatAgo(source.fetchedAt)}.`
      : null}
  </Notice>
);

const REFUSED = {
  linear: {
    mark: <LinearMark />,
    title: "Linear refused the saved API key",
    what: "a new key",
  },
  jira: {
    mark: <JiraMark />,
    title: "Jira refused the saved token",
    what: "a new API token",
  },
} as const;

/** A tracker's key or token stopped working (revoked, expired): the Reconnect state. */
const Refused = ({
  tracker,
  owner,
  onConnect,
}: {
  tracker: "linear" | "jira";
  owner: boolean;
  onConnect: () => void;
}) => {
  const { mark, title, what } = REFUSED[tracker];
  const name = SOURCE_NAME[tracker];
  return (
    <Notice
      testId={`issues-notice-${tracker}-refused`}
      tone="warning"
      icon={mark}
      title={title}
      action={
        owner ? (
          <Button
            size="xs"
            variant="secondary"
            data-testid={`issues-${tracker}-reconnect`}
            onClick={onConnect}
          >
            Reconnect {name}
          </Button>
        ) : null
      }
    >
      {owner
        ? `It may have expired or been revoked. Give ${what} to see this project's ${name} issues again.`
        : `It may have expired or been revoked. The host owner can reconnect ${name} on the host machine.`}
    </Notice>
  );
};

const TrackerInvite = ({
  projectId,
  owner,
  onConnectLinear,
  onConnectJira,
}: {
  projectId: string;
  owner: boolean;
  onConnectLinear: () => void;
  onConnectJira: () => void;
}) => {
  // The key Linear's own invitation used: whoever dismissed that is not asked again.
  const [dismissed, setDismissed] = useLocalStorage<boolean>(
    `aop:issues-linear-invite-dismissed:v1:${projectId}`,
    false,
  );
  if (dismissed === true) return null;
  return (
    <Notice
      testId="issues-notice-trackers"
      icon={<CircleDotIcon />}
      title="Connect an issue tracker"
      onDismiss={() => setDismissed(true)}
      action={
        owner ? (
          <>
            <Button
              size="xs"
              variant="secondary"
              data-testid="issues-linear-connect"
              onClick={onConnectLinear}
            >
              <LinearMark />
              Connect Linear
            </Button>
            <Button
              size="xs"
              variant="secondary"
              data-testid="issues-jira-connect"
              onClick={onConnectJira}
            >
              <JiraMark />
              Connect Jira
            </Button>
          </>
        ) : null
      }
    >
      {owner
        ? "List a Linear team's or Jira projects' issues here beside GitHub's."
        : "The host owner can connect Linear or Jira on the host machine."}
    </Notice>
  );
};

const OffGithub = ({ sources }: { sources: readonly IssueSourceStatus[] }) => (
  <p data-testid="issues-notice-off-github" className="px-1 text-meta text-text-subtle">
    {sources.map((source) => source.name).join(", ")} {sources.length === 1 ? "has" : "have"} no
    GitHub remote, so {sources.length === 1 ? "its" : "their"} issues are not listed.
  </p>
);

/** A message from `gh` or Linear as a sentence, so another can follow it. */
const sentence = (text: string): string => {
  const trimmed = text.trim();
  return !trimmed || /[.!?)]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const copyCommand = async (command: string) => {
  try {
    await navigator.clipboard.writeText(command);
    toast.success(`Copied ${command}`);
  } catch {
    toast.error("Could not copy the command");
  }
};
