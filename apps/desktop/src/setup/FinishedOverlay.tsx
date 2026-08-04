import type { ReactElement } from "react";
import { BrandBig, SpinnerIcon } from "./icons";

export interface DashboardError {
  message: string;
  onOpenLogs: () => void;
}

interface FinishedOverlayProps {
  onBack: () => void;
  error?: DashboardError | null;
}

/** Full-screen overlay shown once the user opens the dashboard, while the sidecar spins up.
 * Flips to an error variant (with an Open logs action) if the sidecar fails to start. */
export const FinishedOverlay = ({ onBack, error = null }: FinishedOverlayProps): ReactElement => (
  <div
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 80,
      background: "var(--canvas)",
      display: "grid",
      placeItems: "center",
      animation: "aop-in .3s ease",
    }}
  >
    <div style={{ textAlign: "center", maxWidth: 430, padding: 30 }}>
      <div
        className="aop-pop"
        style={{
          width: 74,
          height: 74,
          borderRadius: 20,
          margin: "0 auto",
          display: "grid",
          placeItems: "center",
          background: error
            ? "color-mix(in srgb,var(--bad) 15%,transparent)"
            : "color-mix(in srgb,var(--action) 15%,transparent)",
          boxShadow: error
            ? "0 16px 50px -16px color-mix(in srgb,var(--bad) 55%,transparent)"
            : "0 16px 50px -16px color-mix(in srgb,var(--action) 55%,transparent)",
        }}
      >
        {error ? (
          <svg
            width="38"
            height="38"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--bad)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
        ) : (
          <BrandBig />
        )}
      </div>
      <h2 style={{ margin: "23px 0 0", font: "600 27px 'Jura',sans-serif" }}>
        {error ? "Could not start AOP" : "Welcome to AOP"}
      </h2>
      <p style={{ margin: "9px 0 0", fontSize: "14.5px", color: "var(--muted)", lineHeight: 1.5 }}>
        {error
          ? error.message
          : "Setup complete. Spinning up your workspace and waking your workers…"}
      </p>
      {error ? (
        <div>
          <button
            type="button"
            onClick={error.onOpenLogs}
            style={{
              marginTop: 22,
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--muted)",
              borderRadius: 10,
              padding: "9px 15px",
              font: "600 12.5px 'Instrument Sans'",
              cursor: "pointer",
              marginRight: 8,
            }}
          >
            Open logs
          </button>
          <button
            type="button"
            onClick={onBack}
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
            Back to setup
          </button>
        </div>
      ) : (
        <>
          <div
            style={{
              marginTop: 22,
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              color: "var(--muted)",
              font: "500 12px 'Geist Mono'",
            }}
          >
            <SpinnerIcon />
            Loading dashboard
          </div>
          <div>
            <button
              type="button"
              onClick={onBack}
              style={{
                marginTop: 26,
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--muted)",
                borderRadius: 10,
                padding: "9px 15px",
                font: "600 12.5px 'Instrument Sans'",
                cursor: "pointer",
              }}
            >
              Back to setup
            </button>
          </div>
        </>
      )}
    </div>
  </div>
);
