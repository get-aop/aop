import type { RuntimeConfigurationProvider, RuntimeStatus } from "@aop/common";
import { EllipsisIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { RuntimeProviderIcon } from "@/ui/provider-icon";

const AUTH_LABELS: Record<RuntimeStatus["auth"], string> = {
  "logged-in": "Logged in",
  "logged-out": "Not logged in",
  unknown: "Login unknown",
};

/**
 * One runtime on AOP settings › Runtimes: its command, what the host found for it (the command
 * on PATH, its version, whether it is logged in), its models, and its actions. The built-in one
 * can be cloned but not edited or removed.
 */
export const RuntimeRow = ({
  runtime,
  status,
  isDefault,
  onEdit,
  onClone,
  onRemove,
}: {
  runtime: RuntimeConfigurationProvider;
  /** Undefined while the host has not looked yet. */
  status: RuntimeStatus | undefined;
  isDefault: boolean;
  onEdit: () => void;
  onClone: () => void;
  onRemove: () => void;
}) => (
  <div
    data-testid="runtime-row"
    data-runtime-id={runtime.id}
    className="flex min-w-0 items-start gap-3 rounded-row border border-border bg-raised px-3 py-2"
  >
    <RuntimeProviderIcon runtime={runtime.driver} className="mt-0.5 size-5 shrink-0" />
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[13px] font-medium text-text">{runtime.name}</span>
        {runtime.builtIn ? <Badge variant="tag">Built-in</Badge> : null}
        {isDefault ? (
          <Badge variant="tag" data-testid="runtime-default-badge">
            Default
          </Badge>
        ) : null}
      </div>
      <div className="truncate font-mono text-[11px] text-text-subtle">{runtime.command}</div>
      <RuntimeStatusLine status={status} />
    </div>
    <div className="hidden max-w-56 flex-wrap justify-end gap-1 md:flex">
      {runtime.models.slice(0, 4).map((model) => (
        <Badge key={model.id} variant="tag">
          {model.model}
        </Badge>
      ))}
      {runtime.models.length > 4 ? <Badge variant="tag">+{runtime.models.length - 4}</Badge> : null}
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${runtime.name}`}
          className="grid size-6 shrink-0 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
        >
          <EllipsisIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {runtime.builtIn ? null : <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>}
        <DropdownMenuItem onSelect={onClone}>Clone</DropdownMenuItem>
        {runtime.builtIn ? null : (
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            Remove
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

const RuntimeStatusLine = ({ status }: { status: RuntimeStatus | undefined }) => {
  if (!status) {
    return <p className="mt-1 text-[12px] text-text-subtle">Checking…</p>;
  }
  const facts = status.path
    ? ["Found", status.version ? `v${status.version}` : "Version unknown", AUTH_LABELS[status.auth]]
    : ["Not found"];
  return (
    <div data-testid="runtime-status" className="mt-1 flex flex-col gap-0.5 text-[12px]">
      <span className={cn(status.ready ? "text-text-muted" : "text-blocked")}>
        {status.ready ? "Ready" : "Not ready"} · {facts.join(" · ")}
      </span>
      {status.reason ? <span className="break-all text-text-subtle">{status.reason}</span> : null}
    </div>
  );
};
