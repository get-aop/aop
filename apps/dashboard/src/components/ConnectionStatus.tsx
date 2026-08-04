import type { ConnectionState } from "../types";

interface ConnectionStatusProps {
  state: ConnectionState;
}

export const ConnectionStatus = ({ state }: ConnectionStatusProps) => {
  if (state === "disconnected") {
    return (
      <div className="flex items-center">
        <div className="h-2.5 w-2.5 rounded-full bg-text-subtle opacity-50" />
      </div>
    );
  }

  if (state === "idle") {
    return (
      <div className="flex items-center">
        <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-favorite/15" />
      </div>
    );
  }

  return null;
};
