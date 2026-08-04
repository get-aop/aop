import type { RuntimeConfigurationModelInput } from "@aop/common";
import {
  type RuntimeConfigurationProvider,
  RuntimeConfigurationProviderInputSchema,
  type RuntimeDriver,
} from "@aop/common";
import { EllipsisIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/ui/field";
import { Input } from "@/ui/input";
import { RuntimeProviderIcon } from "@/ui/provider-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Textarea } from "@/ui/textarea";
import {
  cloneRuntimeConfigurationProvider,
  createRuntimeConfigurationModel,
  createRuntimeConfigurationProvider,
  deleteRuntimeConfigurationProvider,
  getRuntimeConfiguration,
  updateRuntimeConfigurationProvider,
} from "../api/client";
import { useRuntimeConfiguration } from "../hooks/runtime-configuration";

/** Mirrors @aop/common SAFE_CUSTOM_RUNTIME_MODEL_PATTERN (not re-exported). */
const SAFE_CUSTOM_RUNTIME_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,199}$/;

const DRIVERS: Array<{ value: RuntimeDriver; label: string }> = [
  { value: "custom", label: "Custom" },
  { value: "claude-code", label: "Claude Code" },
  { value: "codex-cli", label: "Codex CLI" },
  { value: "grok-build", label: "Grok Build" },
  { value: "pi", label: "Pi" },
  { value: "opencode", label: "OpenCode" },
];

interface RuntimeDraft {
  id?: string;
  name: string;
  command: string;
  driver: RuntimeDriver;
  models: string;
}

const emptyDraft = (): RuntimeDraft => ({
  name: "",
  command: "",
  driver: "custom",
  models: "",
});

/** Settings §Runtimes — simplified: provider rows with model chips + add/clone/remove. */
export const SettingsRuntimes = () => {
  const { refresh: refreshConfiguration } = useRuntimeConfiguration();
  const [providers, setProviders] = useState<RuntimeConfigurationProvider[] | null>(null);
  const [draft, setDraft] = useState<RuntimeDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RuntimeConfigurationProvider | null>(null);

  const reload = useCallback(async () => {
    try {
      setProviders(await getRuntimeConfiguration());
    } catch {
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The built-in runtimes (Claude Code, Codex CLI, Grok Build, OpenCode, Pi)
  // are fixed defaults inside AOP; the settings page only manages custom ones.
  const customProviders = providers?.filter((provider) => !provider.builtIn) ?? null;

  const parseModels = (modelsText: string): RuntimeConfigurationModelInput[] =>
    modelsText
      .split("\n")
      .map((model) => model.trim())
      .filter(Boolean)
      .map((model) => {
        if (!SAFE_CUSTOM_RUNTIME_MODEL_PATTERN.test(model)) {
          throw new Error(`Model must be a valid identifier: ${model}`);
        }
        return { description: model, model, thinkingLevels: ["low", "medium", "high"] };
      });

  const persist = async (draftToSave: RuntimeDraft) => {
    setSaving(true);
    try {
      const parsed = parseDraft(draftToSave);
      if (parsed) await finishSave(draftToSave, parsed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the runtime");
    } finally {
      setSaving(false);
    }
  };

  const finishSave = async (
    draftToSave: RuntimeDraft,
    parsed: { name: string; command: string; driver: RuntimeDriver },
  ) => {
    await saveRuntime(draftToSave, parsed);
    toast.success(draftToSave.id ? "Runtime updated" : "Runtime added");
    setDraft(null);
    await reload();
    void refreshConfiguration();
  };

  const parseDraft = (
    draftToSave: RuntimeDraft,
  ): { name: string; command: string; driver: RuntimeDriver } | null => {
    const parsed = RuntimeConfigurationProviderInputSchema.safeParse({
      name: draftToSave.name,
      command: draftToSave.command,
      driver: draftToSave.driver,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid runtime");
      return null;
    }
    return parsed.data;
  };

  const saveRuntime = async (
    draftToSave: RuntimeDraft,
    input: { name: string; command: string; driver: RuntimeDriver },
  ) => {
    const models = parseModels(draftToSave.models);
    if (draftToSave.id) {
      await updateRuntimeConfigurationProvider(draftToSave.id, input);
      return;
    }
    const provider = await createRuntimeConfigurationProvider(input);
    for (const model of models) {
      await createRuntimeConfigurationModel(provider.id, model);
    }
  };

  const clone = async (provider: RuntimeConfigurationProvider) => {
    try {
      await cloneRuntimeConfigurationProvider(provider.id, {
        name: `${provider.name} copy`,
        command: provider.command,
        driver: provider.driver,
      });
      toast.success("Runtime cloned");
      await reload();
      void refreshConfiguration();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not clone the runtime");
    }
  };

  const remove = async (provider: RuntimeConfigurationProvider) => {
    setDeleteTarget(null);
    try {
      await deleteRuntimeConfigurationProvider(provider.id);
      toast.success("Runtime removed");
      await reload();
      void refreshConfiguration();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the runtime");
    }
  };

  return (
    <div data-testid="section-runtimes" className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[13px] font-semibold text-text">Runtimes</h2>
        <Button variant="secondary" size="sm" onClick={() => setDraft(emptyDraft())}>
          <PlusIcon className="size-3.5" />
          Add custom runtime
        </Button>
      </div>
      <p className="text-[12px] text-text-subtle">
        Custom provider commands and their curated model catalogs. The built-in runtimes are fixed
        inside AOP; effort and Fast remain usage-time choices in the composer.
      </p>

      {customProviders === null ? (
        <p className="py-6 text-center text-[12px] text-text-subtle">Loading runtimes…</p>
      ) : customProviders.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No custom runtimes</EmptyTitle>
            <EmptyDescription>
              Add a custom runtime to extend the built-in catalog.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        customProviders.map((provider) => (
          <div
            key={provider.id}
            data-testid="runtime-row"
            className="flex min-w-0 items-center gap-3 rounded-row border border-border bg-raised px-3 py-2"
          >
            <RuntimeProviderIcon runtime={provider.driver} className="size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium text-text">{provider.name}</span>
              </div>
              <div className="truncate font-mono text-[11px] text-text-subtle">
                {provider.command}
              </div>
            </div>
            <div className="hidden max-w-56 flex-wrap justify-end gap-1 md:flex">
              {provider.models.slice(0, 4).map((model) => (
                <Badge key={model.id} variant="tag">
                  {model.model}
                </Badge>
              ))}
              {provider.models.length > 4 ? (
                <Badge variant="tag">+{provider.models.length - 4}</Badge>
              ) : null}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Actions for ${provider.name}`}
                  className="grid size-6 shrink-0 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
                >
                  <EllipsisIcon className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() =>
                    setDraft({
                      id: provider.id,
                      name: provider.name,
                      command: provider.command,
                      driver: provider.driver,
                      models: provider.models.map((m) => m.model).join("\n"),
                    })
                  }
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void clone(provider)}>Clone</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(provider)}>
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="w-[480px]">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit runtime" : "Add custom runtime"}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="runtime-name">Name</FieldLabel>
                <Input
                  id="runtime-name"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="runtime-command">Command</FieldLabel>
                <Input
                  id="runtime-command"
                  value={draft.command}
                  onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                />
                <FieldDescription>A single executable token (e.g. claude-code).</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="runtime-driver">Driver</FieldLabel>
                <Select
                  value={draft.driver}
                  onValueChange={(value) => setDraft({ ...draft, driver: value as RuntimeDriver })}
                >
                  <SelectTrigger id="runtime-driver" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DRIVERS.map((driver) => (
                      <SelectItem key={driver.value} value={driver.value}>
                        {driver.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="runtime-models">Models</FieldLabel>
                <Textarea
                  id="runtime-models"
                  rows={4}
                  value={draft.models}
                  onChange={(event) => setDraft({ ...draft, models: event.target.value })}
                  placeholder={"one model id per line"}
                />
                <FieldDescription>One model identifier per line.</FieldDescription>
              </Field>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || !draft}
              onClick={() => draft && void persist(draft)}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent className="w-[512px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove runtime?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.name}” will be removed from the runtime catalog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && void remove(deleteTarget)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
