import { useEffect, useRef } from "react";

export interface LogLine {
  id?: string;
  type: "stdout" | "stderr";
  content: string;
  timestamp: string;
  stepExecutionId?: string;
}

interface LogViewerProps {
  lines: LogLine[];
  autoScroll?: boolean;
}

export const LogViewer = ({ lines, autoScroll = true }: LogViewerProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const linesCount = lines.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: linesCount triggers scroll on new lines
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [linesCount, autoScroll]);

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 overflow-y-auto rounded-card bg-canvas p-4 font-mono text-xs"
      data-testid="log-viewer"
    >
      {lines.length === 0 ? (
        <span className="font-sans text-sm text-text-muted">Waiting for logs...</span>
      ) : (
        lines.map((line) => (
          <div
            key={line.id ?? `${line.timestamp}-${line.type}-${line.content}`}
            className={`whitespace-pre-wrap break-all ${
              line.type === "stderr" ? "text-blocked" : "text-text"
            }`}
          >
            {line.content}
          </div>
        ))
      )}
    </div>
  );
};
