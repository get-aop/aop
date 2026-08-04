import type { RuntimeEvent, VerificationEvidence } from "@aop/common";
import type { CSSProperties } from "react";
import type { ExecutionUsage } from "../api/client";
import { type LogLine, LogViewer } from "../components/LogViewer";
import { formatDurationMs } from "../utils/format";

const PANEL_STYLE: CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "14px",
  overflow: "hidden",
};

const toVerificationEvidence = (event: RuntimeEvent): VerificationEvidence | null => {
  if (event.kind !== "verification_evidence_recorded") return null;
  const evidence = event.metadata?.evidence;
  return isVerificationEvidence(evidence) ? evidence : null;
};

const isVerificationEvidence = (value: unknown): value is VerificationEvidence => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as Partial<VerificationEvidence>;
  return (
    typeof evidence.kind === "string" &&
    typeof evidence.status === "string" &&
    typeof evidence.summary === "string" &&
    typeof evidence.startedAt === "string" &&
    typeof evidence.endedAt === "string"
  );
};

export const LogPanel = ({
  isStreamingLive,
  hasStepSelected,
  logsConnected,
  displayedLogs,
  runtimeEvents = [],
  executionUsage,
}: {
  isStreamingLive: boolean;
  hasStepSelected: boolean;
  logsConnected: boolean;
  displayedLogs: LogLine[];
  runtimeEvents?: RuntimeEvent[];
  executionUsage: ExecutionUsage | null;
}) => {
  const evidence = runtimeEvents.map(toVerificationEvidence).filter((item) => item !== null);

  return (
    <section
      style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", ...PANEL_STYLE }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600 }}>
            Execution evidence
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--color-text-subtle)",
            }}
          >
            {isStreamingLive ? "Live logs" : hasStepSelected ? "Step logs" : "Logs"}
          </span>
        </div>
        {isStreamingLive ? (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              fontWeight: 500,
              color: logsConnected ? "var(--color-ok)" : "var(--color-text-subtle)",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: logsConnected ? "var(--color-ok)" : "var(--color-text-subtle)",
              }}
            />
            {logsConnected ? "Connected" : "Connecting..."}
          </span>
        ) : null}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          overflow: "hidden",
          padding: "16px",
        }}
      >
        <SpendPanel usage={executionUsage} />
        <ExecutionProofPanel evidence={evidence} />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            borderRadius: "10px",
            border: "1px solid var(--color-border)",
          }}
        >
          <LogViewer lines={displayedLogs} autoScroll={isStreamingLive} />
        </div>
      </div>
    </section>
  );
};

const SpendPanel = ({ usage }: { usage: ExecutionUsage | null | undefined }) => {
  if (!usage?.totals || (usage.totals.durationMs === 0 && usage.totals.totalTokens === 0)) {
    return null;
  }

  const stats: string[] = [];
  if (usage.totals.durationMs > 0) stats.push(formatDurationMs(usage.totals.durationMs));
  if (usage.totals.totalTokens > 0)
    stats.push(`${usage.totals.totalTokens.toLocaleString()} tokens`);
  if (usage.totals.costUsd > 0) stats.push(`$${usage.totals.costUsd.toFixed(4)}`);
  if (stats.length === 0) return null;

  return (
    <section
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: "12px",
        borderRadius: "10px",
        border: "1px solid var(--color-border)",
        background: "var(--color-raised)",
        padding: "8px 12px",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: ".08em",
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
        }}
      >
        Spend
      </span>
      {stats.map((stat) => (
        <span
          key={stat}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--color-text-muted)",
          }}
        >
          {stat}
        </span>
      ))}
    </section>
  );
};

const ExecutionProofPanel = ({ evidence }: { evidence: VerificationEvidence[] }) => {
  if (evidence.length === 0) return null;

  return (
    <section
      style={{
        flexShrink: 0,
        borderRadius: "10px",
        border: "1px solid var(--color-border)",
        background: "var(--color-raised)",
        padding: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <h3 style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600 }}>
          Execution proof
        </h3>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: ".08em",
            color: "var(--color-text-muted)",
          }}
        >
          {evidence.length} evidence record{evidence.length === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ marginTop: "12px", display: "grid", gap: "8px" }}>
        {evidence.map((item) => (
          <EvidenceCard
            key={`${item.kind}:${item.command ?? item.source ?? item.summary}`}
            item={item}
          />
        ))}
      </div>
    </section>
  );
};

const EvidenceCard = ({ item }: { item: VerificationEvidence }) => (
  <article
    style={{
      borderRadius: "8px",
      border: "1px solid var(--color-border)",
      background: "var(--color-surface)",
      padding: "12px",
    }}
  >
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
      <span
        style={{
          borderRadius: "6px",
          border: "1px solid var(--color-border)",
          padding: "2px 8px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 500,
          color: "var(--color-text-muted)",
        }}
      >
        {item.kind}
      </span>
      <span
        style={{ color: item.status === "passed" ? "var(--color-ok)" : "var(--color-blocked)" }}
      >
        {item.status}
      </span>
      {typeof item.exitCode === "number" ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 500,
            color: "var(--color-text-subtle)",
          }}
        >
          exit {item.exitCode}
        </span>
      ) : null}
    </div>
    <p style={{ margin: "8px 0 0", fontSize: "13.5px", color: "var(--color-text-muted)" }}>
      {item.summary}
    </p>
    {item.command ? (
      <p
        style={{
          margin: "8px 0 0",
          wordBreak: "break-all",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 500,
          color: "var(--color-text-subtle)",
        }}
      >
        {item.command}
      </p>
    ) : null}
  </article>
);

export const EmptyRunPanel = () => (
  <section
    style={{
      flex: 1,
      minHeight: 0,
      display: "grid",
      placeItems: "center",
      textAlign: "center",
      ...PANEL_STYLE,
      padding: "30px",
    }}
  >
    <div>
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600 }}>
        Execution evidence
      </div>
      <div
        style={{
          fontSize: "13px",
          color: "var(--color-text-subtle)",
          marginTop: "6px",
          maxWidth: "300px",
          lineHeight: 1.5,
        }}
      >
        Approve the plan and continue the task — step output and screenshots show up here as it
        runs.
      </div>
    </div>
  </section>
);
