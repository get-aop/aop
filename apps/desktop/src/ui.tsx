import { type ReactNode, useState } from "react";

export const Brand = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <div className="brand">
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" role="img" aria-label="AOP">
      <rect width="32" height="32" rx="8" fill="#0f1117" />
      <circle cx="10" cy="22" r="3" fill="var(--running)" opacity="0.9" />
      <circle cx="16" cy="18" r="2.5" fill="var(--blocked)" opacity="0.85" />
      <circle cx="22" cy="20" r="2" fill="#c4b5fd" opacity="0.8" />
    </svg>
    <div>
      <h1>{title}</h1>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
    </div>
  </div>
);

export type Tone = "ok" | "busy" | "warning" | "error" | "idle";

export const StatusLine = ({
  tone,
  label,
  testId,
}: {
  tone: Tone;
  label: string;
  testId: string;
}) => (
  <span className="status" data-testid={testId} data-tone={tone}>
    <span className="dot" data-tone={tone} aria-hidden="true" />
    {label}
  </span>
);

export const Notice = ({
  tone = "info",
  testId,
  children,
}: {
  tone?: "info" | "warning" | "error";
  testId?: string;
  children: ReactNode;
}) => (
  <div
    className="notice"
    data-tone={tone}
    data-testid={testId}
    role={tone === "error" ? "alert" : undefined}
  >
    {children}
  </div>
);

/** A command the person runs elsewhere, one click to copy. */
export const CommandBlock = ({ command, testId }: { command: string; testId: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // The command is selectable with one click, so a refused clipboard costs nothing.
    }
  };
  return (
    <div className="command">
      <code data-testid={testId}>{command}</code>
      <button type="button" className="button" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
};

export const Switch = ({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  testId: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    data-testid={testId}
    className="switch"
    onClick={() => onChange(!checked)}
  />
);
