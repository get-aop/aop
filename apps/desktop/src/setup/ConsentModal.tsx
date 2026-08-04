import { type ReactElement, useState } from "react";
import { CheckIcon, ShieldIcon } from "./icons";

export interface ConsentConfig {
  target: string;
  verb: string;
  description: string;
  command: string;
  manual: boolean;
}

interface ConsentModalProps {
  consent: ConsentConfig | null;
  onCancel: () => void;
  onApprove: () => void;
}

export const ConsentModal = ({
  consent,
  onCancel,
  onApprove,
}: ConsentModalProps): ReactElement | null => {
  if (!consent) return null;

  const title = consent.manual ? "Manual setup step" : "Approve setup action";
  const approveLabel = consent.manual ? "I've done this — re-check" : "Approve & run";
  const subline = consent.manual
    ? "AOP can't run this for you — follow the steps below, then re-check."
    : `AOP will ${consent.verb} ${consent.target}.`;
  const previewHeader = consent.manual ? "what to run yourself" : "command preview";
  const footerHint = consent.manual
    ? "Run the step above on your machine, then come back and re-check."
    : "Review the exact command above — nothing runs until you approve.";

  return (
    <>
      <button
        type="button"
        aria-label="Cancel setup action"
        onClick={onCancel}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 60,
          background: "rgba(0,0,0,.5)",
          animation: "aop-in .15s ease",
          border: "none",
          cursor: "default",
          padding: 0,
        }}
      />
      <div
        role="dialog"
        aria-label={title}
        style={{
          position: "fixed",
          zIndex: 61,
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          width: 520,
          maxWidth: "94vw",
          background: "var(--surface)",
          border: "1px solid var(--border2)",
          borderRadius: 18,
          boxShadow: "var(--menuSh)",
          overflow: "hidden",
          animation: "aop-pop .26s cubic-bezier(.2,.9,.3,1.2)",
        }}
      >
        <div style={{ padding: "22px 24px 0", display: "flex", alignItems: "flex-start", gap: 13 }}>
          <span
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "color-mix(in srgb,var(--teal) 13%,transparent)",
              color: "var(--teal)",
            }}
          >
            <ShieldIcon />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "600 19px 'Jura',sans-serif" }}>{title}</div>
            <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>
              {subline}
            </div>
          </div>
        </div>
        <div style={{ padding: "14px 24px 0" }}>
          <p style={{ margin: 0, fontSize: "13.5px", color: "var(--muted)", lineHeight: 1.6 }}>
            {consent.description}
          </p>
          <CommandPreview key={consent.command} header={previewHeader} command={consent.command} />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginTop: 12,
              fontSize: 12,
              color: "var(--subtle)",
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            {footerHint}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            padding: "18px 24px 22px",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--muted)",
              borderRadius: 11,
              padding: "11px 17px",
              font: "600 13.5px 'Instrument Sans'",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="aop-h"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "var(--action)",
              color: "var(--onAction)",
              border: "none",
              borderRadius: 11,
              padding: "11px 19px",
              font: "600 13.5px 'Instrument Sans'",
              cursor: "pointer",
            }}
          >
            <CheckIcon size={15} strokeWidth={2.4} />
            {approveLabel}
          </button>
        </div>
      </div>
    </>
  );
};

type CopyStatus = "idle" | "copied" | "failed";

const CommandPreview = ({ header, command }: { header: string; command: string }): ReactElement => {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  const handleCopy = async (): Promise<void> => {
    const copied = await copyCommand(command);
    setCopyStatus(copied ? "copied" : "failed");
  };

  return (
    <div
      style={{
        marginTop: 14,
        border: "1px solid #1c2233",
        borderRadius: 11,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          background: "#11151f",
          padding: "7px 9px 7px 13px",
          borderBottom: "1px solid #1c2233",
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#fb7185" }} />
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#fbbf24" }} />
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#34d399" }} />
        <span
          style={{
            marginLeft: 6,
            font: "600 10.5px 'Geist Mono'",
            color: "#8088a0",
          }}
        >
          {header}
        </span>
        <button
          type="button"
          aria-label={copyAriaLabel(copyStatus)}
          onClick={() => void handleCopy()}
          style={{
            marginLeft: "auto",
            background: copyStatus === "copied" ? "var(--okFill)" : "transparent",
            border: "1px solid #2a3144",
            borderRadius: 7,
            color: copyStatus === "failed" ? "var(--bad)" : "#aab2c8",
            padding: "5px 9px",
            font: "600 10.5px 'Geist Mono'",
            cursor: "pointer",
          }}
        >
          <span aria-live="polite">{copyButtonLabel(copyStatus)}</span>
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          background: "#0b0e16",
          color: "#e7ecf7",
          font: "500 12.5px 'Geist Mono'",
          padding: 14,
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          lineHeight: 1.6,
        }}
      >
        {command}
      </pre>
    </div>
  );
};

const copyCommand = async (command: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(command);
    return true;
  } catch {
    return copyCommandWithFallback(command);
  }
};

const copyCommandWithFallback = (command: string): boolean => {
  const textarea = document.createElement("textarea");
  textarea.value = command;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand?.("copy") ?? false;
  textarea.remove();
  return copied;
};

const copyButtonLabel = (status: CopyStatus): string => {
  if (status === "copied") return "Copied";
  if (status === "failed") return "Copy failed";
  return "Copy";
};

const copyAriaLabel = (status: CopyStatus): string => {
  if (status === "copied") return "Command copied";
  if (status === "failed") return "Command copy failed";
  return "Copy command";
};
