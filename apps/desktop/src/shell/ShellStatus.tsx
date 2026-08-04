import type { ReactElement } from "react";
import type { SidecarState } from "../backend/types";
import { BrandMark, SpinnerIcon } from "../setup/icons";

interface ShellStatusProps {
  status: "loading-setup" | "starting-dashboard";
  sidecar?: SidecarState | null;
  onOpenLogs?: () => void;
}

export const ShellStatus = ({ status, sidecar, onOpenLogs }: ShellStatusProps): ReactElement => {
  if (sidecar?.status === "failed") {
    return (
      <main
        data-theme="dark"
        style={{
          height: "100vh",
          display: "grid",
          placeItems: "center",
          background: "var(--canvas)",
          color: "var(--text)",
        }}
      >
        <div style={{ maxWidth: 460, padding: 30, textAlign: "center" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              margin: "0 auto",
              display: "grid",
              placeItems: "center",
              background: "color-mix(in srgb,var(--bad) 15%,transparent)",
              color: "var(--bad)",
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 9v4M12 17h.01" />
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
          </div>
          <h1 style={{ margin: "20px 0 0", font: "600 26px 'Jura',sans-serif" }}>
            AOP could not start
          </h1>
          <p style={{ margin: "10px 0 0", fontSize: 15, color: "var(--muted)", lineHeight: 1.5 }}>
            {sidecar.message ?? "The AOP local server did not become ready."}
          </p>
          {sidecar.logPath ? (
            <p
              style={{
                margin: "16px auto 0",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                color: "var(--muted)",
                fontFamily: "'Geist Mono', ui-monospace, monospace",
                fontSize: 12.5,
                padding: "10px 12px",
                wordBreak: "break-all",
              }}
            >
              {sidecar.logPath}
            </p>
          ) : null}
          <div>
            <button
              type="button"
              onClick={onOpenLogs}
              style={{
                marginTop: 22,
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--muted)",
                borderRadius: 10,
                padding: "9px 15px",
                font: "600 12.5px 'Instrument Sans'",
                cursor: "pointer",
              }}
            >
              Open logs
            </button>
          </div>
        </div>
      </main>
    );
  }

  const title = status === "loading-setup" ? "Checking desktop setup" : "Starting AOP";
  const subtitle =
    status === "loading-setup"
      ? "AOP is checking local tools before opening the dashboard."
      : "AOP is starting the local server and preparing the dashboard.";

  return (
    <main
      data-theme="dark"
      style={{
        height: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--canvas)",
        color: "var(--text)",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420, padding: 30 }}>
        <div style={{ display: "inline-flex" }}>
          <BrandMark size={44} />
        </div>
        <h1 style={{ margin: "20px 0 0", font: "600 26px 'Jura',sans-serif" }}>{title}</h1>
        <p style={{ margin: "10px 0 0", fontSize: 15, color: "var(--muted)", lineHeight: 1.5 }}>
          {subtitle}
        </p>
        <div
          style={{
            marginTop: 20,
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            color: "var(--muted)",
            font: "500 12px 'Geist Mono'",
          }}
        >
          <SpinnerIcon />
          {status === "loading-setup" ? "Checking setup" : "Loading dashboard"}
        </div>
      </div>
    </main>
  );
};
