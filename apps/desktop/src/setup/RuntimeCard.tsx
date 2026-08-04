import type { ReactElement } from "react";
import { AgentMark, CheckIcon, CpuIcon, InstallGlyph } from "./icons";
import { Chip, InstallStream, type TerminalLine } from "./parts";
import { borderFor, chipFor, type UiStatus } from "./setup-ui";

export interface AgentTileProps {
  id: string;
  name: string;
  tagline: string;
  tint: string;
  recommended: boolean;
  ready: boolean;
  selectedActive: boolean;
  statusLabel: string;
  statusFg: string;
  onSelect: () => void;
}

const RUNTIME_TINT: Record<string, string> = {
  codex: "var(--teal)",
  claude: "var(--amber)",
  opencode: "var(--lav)",
  pi: "var(--bad)",
};

const tileBorder = (tile: AgentTileProps): string => {
  if (tile.ready) return "color-mix(in srgb,var(--ok) 45%,var(--border))";
  if (tile.selectedActive) return "var(--teal)";
  return "var(--border)";
};

const tileBg = (tile: AgentTileProps): string => {
  if (tile.ready) return "color-mix(in srgb,var(--ok) 8%,var(--surface))";
  if (tile.selectedActive) return "color-mix(in srgb,var(--teal) 9%,var(--surface))";
  return "var(--raised)";
};

const AgentTile = (tile: AgentTileProps): ReactElement => {
  const tint = RUNTIME_TINT[tile.id] ?? "var(--teal)";
  return (
    <button
      type="button"
      onClick={tile.onSelect}
      className="aop-h"
      style={{
        position: "relative",
        border: `1.5px solid ${tileBorder(tile)}`,
        background: tileBg(tile),
        borderRadius: 15,
        padding: "15px 14px 14px",
        cursor: "pointer",
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {tile.recommended && !tile.ready ? (
        <span
          style={{
            position: "absolute",
            top: 11,
            right: 11,
            font: "700 8px 'Geist Mono'",
            letterSpacing: ".07em",
            color: "var(--teal)",
            background: "color-mix(in srgb,var(--teal) 15%,transparent)",
            borderRadius: 5,
            padding: "3px 6px",
          }}
        >
          RECOMMENDED
        </span>
      ) : null}
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: 11,
          display: "grid",
          placeItems: "center",
          background: `color-mix(in srgb,${tint} 16%,transparent)`,
          color: tint,
        }}
      >
        <AgentMark id={tile.id} />
      </span>
      <div style={{ font: "600 15px 'Jura',sans-serif", marginTop: 11 }}>{tile.name}</div>
      <div style={{ fontSize: "11.5px", color: "var(--subtle)", marginTop: 1 }}>{tile.tagline}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 11,
          font: "600 11px 'Geist Mono'",
          color: tile.statusFg,
        }}
      >
        {tile.ready ? <CheckIcon size={13} strokeWidth={2.8} /> : null}
        {tile.selectedActive ? (
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "3.5px solid var(--teal)",
            }}
          />
        ) : null}
        {!tile.ready && !tile.selectedActive ? (
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "2px solid var(--border2)",
            }}
          />
        ) : null}
        {tile.statusLabel}
      </div>
    </button>
  );
};

export interface RuntimeCardProps {
  status: UiStatus;
  message: string;
  agents: AgentTileProps[];
  selectedName: string;
  installLabel: string;
  onInstall: () => void;
  confirm: boolean;
  showPicker: boolean;
  onChange: () => void;
  installing: boolean;
  installLines: TerminalLine[];
}

const RuntimeCardImpl = ({
  status,
  message,
  agents,
  selectedName,
  installLabel,
  onInstall,
  confirm,
  showPicker,
  onChange,
  installing,
  installLines,
}: RuntimeCardProps): ReactElement => {
  const chipLabel = status === "missing" ? "Pick one" : undefined;
  const borderColor = installing ? "var(--work)" : borderFor(status === "ready" ? "ready" : status);

  return (
    <div
      className="aop-card"
      style={{
        background: "var(--surface)",
        border: `1px solid ${borderColor}`,
        borderRadius: 18,
        padding: "20px 22px",
        boxShadow: "var(--card1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
        <span
          style={{
            width: 46,
            height: 46,
            borderRadius: 13,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            background: "color-mix(in srgb,var(--teal) 14%,transparent)",
            color: "var(--teal)",
          }}
        >
          <CpuIcon />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ font: "600 17px 'Jura',sans-serif" }}>Coding agent</span>
            <Chip chip={chipFor(status, chipLabel)} />
          </div>
          <div
            style={{ fontSize: "13.5px", color: "var(--muted)", marginTop: 3, lineHeight: 1.45 }}
          >
            {message}
          </div>
        </div>
        {confirm ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span
              className="aop-pop"
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                display: "grid",
                placeItems: "center",
                background: "var(--okFill)",
                color: "var(--ok)",
              }}
            >
              <CheckIcon size={17} />
            </span>
            <button
              type="button"
              onClick={onChange}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--muted)",
                borderRadius: 10,
                padding: "8px 13px",
                font: "600 12.5px 'Instrument Sans'",
                cursor: "pointer",
              }}
            >
              Change
            </button>
          </div>
        ) : null}
      </div>

      {showPicker ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2,1fr)",
              gap: 11,
              marginTop: 17,
            }}
          >
            {agents.map((tile) => (
              <AgentTile key={tile.id} {...tile} />
            ))}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 16,
            }}
          >
            <span style={{ font: "500 12px 'Geist Mono'", color: "var(--subtle)" }}>
              You only need one · {selectedName} selected
            </span>
            <button
              type="button"
              onClick={onInstall}
              className="aop-h"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "var(--action)",
                color: "var(--onAction)",
                border: "none",
                borderRadius: 11,
                padding: "11px 18px",
                font: "600 13.5px 'Instrument Sans'",
                cursor: "pointer",
              }}
            >
              <InstallGlyph />
              {installLabel}
            </button>
          </div>
        </>
      ) : null}

      {installing ? <InstallStream lines={installLines} /> : null}
    </div>
  );
};

export const RuntimeCard = RuntimeCardImpl;
