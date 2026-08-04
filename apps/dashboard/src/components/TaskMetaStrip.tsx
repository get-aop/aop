import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { Task } from "../types";

interface MetaItem {
  label: string;
  value: string;
  color: string;
  icon: ReactNode;
  href?: string;
  onNavigate?: (href: string) => void;
}

interface TaskMetaStripProps {
  task: Task;
  repoName: string;
  workflow: string;
  workflowHref?: string;
  onWorkflowNavigate?: (href: string) => void;
  assignee: string;
  runtime: string;
  created: string;
}

// Inline SVG icons copied verbatim from the AOP Studio design concept
// (taskDetailVals meta array, script ~1310-1314). 15px stroke icons.
const FolderIcon = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
  </svg>
);

const FlowIcon = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <path d="M6 6h.01M18 6h.01M12 18h.01" />
    <path d="M6 8v2a2 2 0 002 2h8a2 2 0 002-2V8" />
  </svg>
);

const AssigneeIcon = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <path d="M16 11a4 4 0 10-8 0" />
    <path d="M4 21a7 7 0 0116 0" />
  </svg>
);

const RuntimeIcon = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <path d="M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2" />
  </svg>
);

const CreatedIcon = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <path d="M3 9h18" />
    <path d="M3 5h18v16H3zM8 3v4M16 3v4" />
  </svg>
);

const CHIP_STYLE: CSSProperties = {
  width: "28px",
  height: "28px",
  borderRadius: "8px",
  display: "grid",
  placeItems: "center",
  background: "var(--color-raised)",
  flexShrink: 0,
};

/**
 * The horizontal metadata row under the task top bar (mockup line 341-348).
 * Each item is a 28px var(--color-raised) icon chip + 9px Geist Mono label + 13px
 * value, separated by a right hairline. Purely presentational — maps the real
 * task fields the detail view already surfaced.
 */
export const TaskMetaStrip = ({
  repoName,
  workflow,
  workflowHref,
  onWorkflowNavigate,
  assignee,
  runtime,
  created,
}: TaskMetaStripProps) => {
  const items: MetaItem[] = [
    { label: "Repository", value: repoName, color: "var(--color-running)", icon: FolderIcon },
    {
      label: "Workflow",
      value: workflow,
      color: "var(--color-queued)",
      icon: FlowIcon,
      href: workflowHref,
      onNavigate: onWorkflowNavigate,
    },
    { label: "Assignee", value: assignee, color: "var(--color-favorite)", icon: AssigneeIcon },
    { label: "Runtime", value: runtime, color: "var(--color-text-subtle)", icon: RuntimeIcon },
    { label: "Created", value: created, color: "var(--color-text-subtle)", icon: CreatedIcon },
  ];

  return (
    <div
      data-testid="task-meta-strip"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        padding: "11px 24px",
        borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
        flexWrap: "wrap",
      }}
    >
      {items.map((item, index) => (
        <MetaCell key={item.label} item={item} isLast={index === items.length - 1} />
      ))}
    </div>
  );
};

const MetaCell = ({ item, isLast }: { item: MetaItem; isLast: boolean }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "9px",
      padding: isLast ? 0 : "0 18px 0 0",
      marginRight: isLast ? 0 : "18px",
      borderRight: isLast ? "none" : "1px solid var(--color-border)",
    }}
  >
    <span style={{ ...CHIP_STYLE, color: item.color }}>{item.icon}</span>
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: ".08em",
          color: "var(--color-text-subtle)",
          textTransform: "uppercase",
        }}
      >
        {item.label}
      </div>
      <MetaValue item={item} />
    </div>
  </div>
);

const MetaValue = ({ item }: { item: MetaItem }) => {
  const style: CSSProperties = {
    fontFamily: "var(--font-sans)",
    fontSize: 13,
    fontWeight: 600,
    marginTop: "1px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  if (item.href) {
    return (
      <a
        href={item.href}
        title={item.value}
        style={{ ...style, color: "inherit" }}
        onClick={(event) => handleMetaLinkClick(event, item)}
      >
        {item.value}
      </a>
    );
  }

  return (
    <div title={item.value} style={style}>
      {item.value}
    </div>
  );
};

const handleMetaLinkClick = (event: MouseEvent<HTMLAnchorElement>, item: MetaItem): void => {
  if (
    !item.href ||
    !item.onNavigate ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  event.preventDefault();
  item.onNavigate(item.href);
};
