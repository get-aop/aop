import type { ReactElement, ReactNode } from "react";
import { BrandMark, MoonIcon, SunIcon } from "./icons";
import type { SetupTheme } from "./useSetupTheme";

interface TopBarProps {
  version: string;
  theme: SetupTheme;
  onToggleTheme: () => void;
  /** Optional control rendered before the version (e.g. the WSL exec host menu on Windows). */
  children?: ReactNode;
}

export const TopBar = ({ version, theme, onToggleTheme, children }: TopBarProps): ReactElement => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "15px 22px",
      borderBottom: "1px solid var(--border)",
      background: "color-mix(in srgb,var(--surface) 55%,transparent)",
      position: "relative",
      zIndex: 5,
      flexShrink: 0,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <BrandMark />
      <span style={{ font: "600 18px 'Jura',sans-serif", letterSpacing: ".02em" }}>AOP</span>
      <span
        style={{
          font: "600 9.5px 'Geist Mono'",
          letterSpacing: ".14em",
          color: "var(--subtle)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "3px 7px",
          marginLeft: 1,
        }}
      >
        SETUP
      </span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
      {children}
      <span style={{ font: "500 11px 'Geist Mono'", color: "var(--subtle)" }}>v{version}</span>
      <button
        type="button"
        onClick={onToggleTheme}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--muted)",
          cursor: "pointer",
          borderRadius: 10,
          padding: "7px 11px",
          font: "600 12.5px 'Instrument Sans'",
        }}
      >
        <span style={{ display: "inline-flex" }}>
          {theme === "dark" ? <MoonIcon /> : <SunIcon />}
        </span>
        {theme === "dark" ? "Dark" : "Light"}
        <span
          style={{
            width: 32,
            height: 17,
            borderRadius: 9,
            background:
              theme === "dark"
                ? "color-mix(in srgb,var(--action) 55%,transparent)"
                : "var(--border2)",
            position: "relative",
            display: "inline-block",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: theme === "dark" ? "17px" : "2px",
              width: 13,
              height: 13,
              borderRadius: "50%",
              background: "#fff",
              transition: "left .16s",
            }}
          />
        </span>
      </button>
    </div>
  </div>
);
