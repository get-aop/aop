import type { CSSProperties, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DesktopBackend, WslDistro } from "../backend/types";

interface ExecHostMenuProps {
  backend: DesktopBackend;
  onChanged: () => void;
}

interface ExecHostSelection {
  changed: boolean;
  distros: WslDistro[];
  mode: string;
}

const loadExecHostSelection = async (backend: DesktopBackend): Promise<ExecHostSelection> => {
  const [distros, currentMode] = await Promise.all([
    backend.listWslDistros(),
    backend.getExecHost(),
  ]);
  const availableModes = distros.map((distro) => `wsl:${distro.name}`);
  if (availableModes.includes(currentMode) || distros.length === 0) {
    return { changed: false, distros, mode: currentMode };
  }

  const selected = distros.find((distro) => distro.isDefault) ?? distros[0];
  if (!selected) return { changed: false, distros, mode: currentMode };
  const mode = `wsl:${selected.name}`;
  await backend.setExecHost(mode);
  return { changed: true, distros, mode };
};

const triggerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  background: "var(--surface)",
  color: "var(--muted)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "7px 10px",
  font: "600 12.5px 'Instrument Sans'",
  cursor: "pointer",
};

/**
 * Compact top-bar control that chooses which WSL distro runs AOP. Renders nothing when WSL
 * is unavailable (non-Windows hosts / WSL not
 * installed), so macOS users never see it and the top bar matches the design exactly.
 * Relocated out of the main setup flow per the redesign — the WSL feature is preserved for
 * Windows users without crowding the setup cards.
 */
export const ExecHostMenu = ({ backend, onChanged }: ExecHostMenuProps): ReactElement | null => {
  const [distros, setDistros] = useState<WslDistro[] | null>(null);
  const [current, setCurrent] = useState("native");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onChangedRef = useRef(onChanged);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    let cancelled = false;

    void loadExecHostSelection(backend)
      .then((selection) => {
        if (cancelled || selection.distros.length === 0) return;
        setDistros(selection.distros);
        setCurrent(selection.mode);
        if (selection.changed) onChangedRef.current();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [backend]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current.find((item) => item?.getAttribute("aria-checked") === "true")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsidePointer);
    return () => document.removeEventListener("mousedown", closeOnOutsidePointer);
  }, [open]);

  if (!distros || distros.length === 0) {
    return null;
  }

  const options = distros.map((distro) => ({
    value: `wsl:${distro.name}`,
    label: `${distro.name}${distro.isDefault ? " (default)" : ""}`,
  }));
  const currentLabel = options.find((option) => option.value === current)?.label ?? current;

  const select = async (mode: string) => {
    if (mode === current || busy) return;
    setOpen(false);
    setBusy(true);
    try {
      await backend.setExecHost(mode);
      setCurrent(mode);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    event.preventDefault();
    const index = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const next = (index + direction + options.length) % options.length;
    itemRefs.current[next]?.focus();
  };

  return (
    <div
      style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
      title="Where AOP runs agents on Windows"
    >
      <span style={{ font: "600 11px 'Geist Mono'", color: "var(--subtle)" }}>Run in</span>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Run agents in"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
          setOpen((value) => !value);
        }}
        style={{ ...triggerStyle, opacity: busy ? 0.6 : 1 }}
      >
        <span>{currentLabel}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && anchor
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              aria-label="Run agents in"
              className="exec-host-menu"
              style={{
                position: "fixed",
                zIndex: 51,
                top: anchor.bottom + 6,
                right: Math.max(8, window.innerWidth - anchor.right),
                minWidth: Math.max(200, anchor.width),
                maxHeight: 340,
                overflowY: "auto",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                boxShadow: "var(--menuSh)",
                padding: 6,
              }}
              onKeyDown={handleMenuKeyDown}
            >
              {options.map((option, index) => (
                <button
                  key={option.value}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.value === current}
                  onClick={() => void select(option.value)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    border: 0,
                    borderRadius: 8,
                    padding: "9px 11px",
                    background: option.value === current ? "var(--raised)" : "transparent",
                    color: "var(--text)",
                    font: "600 13px 'Instrument Sans'",
                    cursor: "pointer",
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === current ? <span aria-hidden="true">✓</span> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
