import type { ReactNode } from "react";

interface DesktopShellProps {
  children: ReactNode;
}

export const DesktopShell = ({ children }: DesktopShellProps) => (
  <div className="desktop-shell">{children}</div>
);
