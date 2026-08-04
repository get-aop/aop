import type { ReactElement } from "react";

type ToastTone = "ok" | "bad";

interface ToastProps {
  message: string | null;
  tone?: ToastTone;
}

const ICONS: Record<ToastTone, ReactElement> = {
  ok: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  bad: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  ),
};

/** Transient toast, centered at the bottom of the window. `bad` tone is used for warnings
 * and setup-action failures so they aren't mistaken for successes. */
export const Toast = ({ message, tone = "ok" }: ToastProps): ReactElement | null => {
  if (!message) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 70,
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        background: tone === "bad" ? "var(--bad)" : "var(--text)",
        color: tone === "bad" ? "#fff" : "var(--canvas)",
        borderRadius: 11,
        padding: "11px 17px",
        font: "600 13px 'Instrument Sans'",
        boxShadow: "var(--menuSh)",
        animation: "aop-in .2s ease",
      }}
    >
      {ICONS[tone]}
      {message}
    </div>
  );
};
