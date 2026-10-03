import { BUILT_IN_RUNTIME_ID, type RuntimeConfigurationProvider } from "@aop/common";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { PermissionChecks } from "../agent-clis/PermissionChecks";
import { cloneRuntimeConfigurationProvider, setDefaultRuntime } from "../api/client";
import { useRuntimeConfiguration } from "../hooks/runtime-configuration";
import { RuntimeNotReady, RuntimeSelect } from "../projects/RuntimeSelect";
import {
  draftOf,
  emptyDraft,
  RemoveRuntimeDialog,
  type RuntimeDraft,
  RuntimeEditDialog,
} from "./settings-runtime-dialogs";
import { RuntimeRow } from "./settings-runtime-row";

/**
 * Settings §Runtimes: whether agents skip permission checks, then every runtime a project can run
 * on (the built-in Claude Code and custom commands that speak its dialect) with what the host
 * finds for each, and the default runtime new projects start on. Agent CLI versions and updates
 * are on AOP settings › Updates.
 */
export const SettingsRuntimes = () => {
  const { providers, defaultRuntimeId, statuses, refresh, refreshStatuses } =
    useRuntimeConfiguration();
  const [draft, setDraft] = useState<RuntimeDraft | null>(null);
  const [removing, setRemoving] = useState<RuntimeConfigurationProvider | null>(null);
  const [checking, setChecking] = useState(false);

  const checkAgain = async () => {
    setChecking(true);
    await refreshStatuses(true);
    setChecking(false);
  };

  const clone = async (runtime: RuntimeConfigurationProvider) => {
    try {
      await cloneRuntimeConfigurationProvider(runtime.id, {
        name: `${runtime.name} copy`,
        command: runtime.command,
        driver: runtime.driver,
      });
      toast.success("Runtime cloned");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not clone the runtime");
    }
  };

  // Removing the default moves its projects to the built-in runtime, which then becomes the default.
  const moveTargetId = removing?.id === defaultRuntimeId ? BUILT_IN_RUNTIME_ID : defaultRuntimeId;
  const moveTargetName =
    providers.find((provider) => provider.id === moveTargetId)?.name ?? "the default runtime";

  return (
    <div data-testid="section-runtimes" className="flex flex-col gap-2 p-4">
      <PermissionChecks />
      <div className="mt-4 flex items-center gap-2">
        <h2 className="flex-1 text-[13px] font-semibold text-text">Runtimes</h2>
        <Button
          variant="ghost"
          size="xs"
          data-testid="runtimes-check"
          disabled={checking}
          onClick={() => void checkAgain()}
        >
          {checking ? "Checking…" : "Check again"}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDraft(emptyDraft())}>
          <PlusIcon className="size-3.5" />
          Add custom runtime
        </Button>
      </div>
      <p className="text-[12px] text-text-subtle">
        What a project's coordinator and threads run on: Claude Code, or a custom command that runs
        it (a wrapper or alias) with its own models. Pick one per project in its settings › Models.
        A runtime is ready when its command is on the host's PATH and it is not logged out.
      </p>

      <DefaultRuntimeRow defaultRuntimeId={defaultRuntimeId} onChanged={refresh} />

      {providers.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-text-subtle">Loading runtimes…</p>
      ) : (
        providers.map((runtime) => (
          <RuntimeRow
            key={runtime.id}
            runtime={runtime}
            status={statuses?.[runtime.id]}
            isDefault={runtime.id === defaultRuntimeId}
            onEdit={() => setDraft(draftOf(runtime))}
            onClone={() => void clone(runtime)}
            onRemove={() => setRemoving(runtime)}
          />
        ))
      )}

      <RuntimeEditDialog draft={draft} onDraft={setDraft} onSaved={refresh} />
      <RemoveRuntimeDialog
        runtime={removing}
        moveTargetName={moveTargetName}
        onClose={() => setRemoving(null)}
        onRemoved={refresh}
      />
    </div>
  );
};

const DefaultRuntimeRow = ({
  defaultRuntimeId,
  onChanged,
}: {
  defaultRuntimeId: string;
  onChanged: () => Promise<void>;
}) => {
  const choose = async (runtimeId: string) => {
    try {
      await setDefaultRuntime(runtimeId);
      await onChanged();
      toast.success("Default runtime changed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the default runtime");
    }
  };
  return (
    <div
      data-testid="default-runtime"
      className="flex flex-col gap-2 rounded-row border border-border bg-raised px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor="default-runtime-select" className="text-[13px] font-medium text-text">
          Default runtime
        </label>
        <span className="text-[12px] text-text-subtle">
          New projects start on it, for the coordinator and for threads. Existing projects keep
          theirs.
        </span>
        <RuntimeNotReady runtimeId={defaultRuntimeId} testId="default-runtime-not-ready" />
      </div>
      <RuntimeSelect
        id="default-runtime-select"
        testId="default-runtime-select"
        label="Default runtime"
        className="w-full sm:w-56"
        value={defaultRuntimeId}
        onChange={(runtimeId) => void choose(runtimeId)}
      />
    </div>
  );
};
