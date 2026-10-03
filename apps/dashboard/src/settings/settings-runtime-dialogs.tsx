import {
  describeFirstIssue,
  type RuntimeConfigurationModelInput,
  type RuntimeConfigurationProvider,
  RuntimeConfigurationProviderInputSchema,
  type RuntimeDriver,
  type RuntimeUsage,
} from "@aop/common";
import { useEffect, useState } from "react";
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
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/ui/field";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import {
  createRuntimeConfigurationModel,
  createRuntimeConfigurationProvider,
  deleteRuntimeConfigurationModel,
  deleteRuntimeConfigurationProvider,
  getRuntimeUsage,
  updateRuntimeConfigurationProvider,
} from "../api/client";

/** Mirrors @aop/common SAFE_CUSTOM_RUNTIME_MODEL_PATTERN (not re-exported). */
const SAFE_CUSTOM_RUNTIME_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,199}$/;

export interface RuntimeDraft {
  /** The runtime being edited; absent for a new one. */
  runtime?: RuntimeConfigurationProvider;
  name: string;
  command: string;
  driver: RuntimeDriver;
  models: string;
}

export const emptyDraft = (): RuntimeDraft => ({
  name: "",
  command: "",
  driver: "claude-code",
  models: "",
});

export const draftOf = (runtime: RuntimeConfigurationProvider): RuntimeDraft => ({
  runtime,
  name: runtime.name,
  command: runtime.command,
  driver: runtime.driver,
  models: runtime.models.map((model) => model.model).join("\n"),
});

/** Adds a custom runtime, or edits one: its name, its command, and its model list. */
export const RuntimeEditDialog = ({
  draft,
  onDraft,
  onSaved,
}: {
  draft: RuntimeDraft | null;
  onDraft: (draft: RuntimeDraft | null) => void;
  onSaved: () => Promise<void>;
}) => {
  const [saving, setSaving] = useState(false);

  const persist = async (draftToSave: RuntimeDraft) => {
    const parsed = RuntimeConfigurationProviderInputSchema.safeParse({
      name: draftToSave.name,
      command: draftToSave.command,
      driver: draftToSave.driver,
    });
    if (!parsed.success) {
      toast.error(describeFirstIssue(parsed.error.issues, "Invalid runtime"));
      return;
    }
    setSaving(true);
    try {
      await saveRuntime(draftToSave, parsed.data);
      toast.success(draftToSave.runtime ? "Runtime updated" : "Runtime added");
      onDraft(null);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the runtime");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onDraft(null)}>
      <DialogContent className="w-[480px]">
        <DialogHeader>
          <DialogTitle>{draft?.runtime ? "Edit runtime" : "Add custom runtime"}</DialogTitle>
        </DialogHeader>
        {draft ? (
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="runtime-name">Name</FieldLabel>
              <Input
                id="runtime-name"
                value={draft.name}
                onChange={(event) => onDraft({ ...draft, name: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="runtime-command">Command</FieldLabel>
              <Input
                id="runtime-command"
                value={draft.command}
                onChange={(event) => onDraft({ ...draft, command: event.target.value })}
              />
              <FieldDescription>
                A single executable on the host's PATH, or its full path (e.g. claude).
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="runtime-models">Models</FieldLabel>
              <Textarea
                id="runtime-models"
                rows={4}
                value={draft.models}
                onChange={(event) => onDraft({ ...draft, models: event.target.value })}
                placeholder={"one model id per line"}
              />
              <FieldDescription>
                One model identifier per line. A runtime needs at least one to be picked.
              </FieldDescription>
            </Field>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onDraft(null)} disabled={saving}>
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
  );
};

/**
 * Asks before removing a runtime. One that projects use is not removed as is: the dialog lists
 * them and offers to move them to the default runtime (the built-in one when the default is the
 * runtime going), then remove it.
 */
export const RemoveRuntimeDialog = ({
  runtime,
  moveTargetName,
  onClose,
  onRemoved,
}: {
  runtime: RuntimeConfigurationProvider | null;
  moveTargetName: string;
  onClose: () => void;
  onRemoved: () => Promise<void>;
}) => {
  const [usage, setUsage] = useState<RuntimeUsage[] | null>(null);

  useEffect(() => {
    setUsage(null);
    if (!runtime) return;
    let current = true;
    getRuntimeUsage(runtime.id)
      .then((found) => current && setUsage(found))
      .catch(() => current && setUsage([]));
    return () => {
      current = false;
    };
  }, [runtime]);

  const remove = async () => {
    if (!runtime) return;
    onClose();
    try {
      await deleteRuntimeConfigurationProvider(runtime.id, {
        moveToDefault: (usage?.length ?? 0) > 0,
      });
      toast.success("Runtime removed");
      await onRemoved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the runtime");
    }
  };

  const used = (usage?.length ?? 0) > 0;
  return (
    <AlertDialog open={runtime !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="w-[512px]" data-testid="remove-runtime-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove runtime?</AlertDialogTitle>
          <AlertDialogDescription>
            {usage === null
              ? "Checking which projects use it…"
              : used
                ? `Projects use “${runtime?.name}”. To remove it, they move to ${moveTargetName}: the next turns of their coordinators and threads run there.`
                : `“${runtime?.name}” will be removed from the runtime catalog.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {used ? (
          <ul data-testid="remove-runtime-usage" className="flex flex-col gap-1 text-[12.5px]">
            {usage?.map((entry) => (
              <li key={entry.projectId} className="text-text">
                <span className="font-medium">{entry.projectName}</span>
                <span className="text-text-subtle"> · {describeUse(entry)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="remove-runtime-confirm"
            disabled={usage === null}
            onClick={() => void remove()}
          >
            {used ? `Move them to ${moveTargetName} and remove` : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const describeUse = (entry: RuntimeUsage): string => {
  const roles = entry.roles.map((role) => (role === "coordinator" ? "coordinator" : "new threads"));
  const threads =
    entry.openThreads > 0
      ? [`${entry.openThreads} open thread${entry.openThreads === 1 ? "" : "s"}`]
      : [];
  return [...roles, ...threads].join(", ");
};

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

// An edit also applies the model list: models no longer listed go, new ones are added.
const saveRuntime = async (
  draft: RuntimeDraft,
  input: { name: string; command: string; driver: RuntimeDriver },
) => {
  const models = parseModels(draft.models);
  if (!draft.runtime) {
    const provider = await createRuntimeConfigurationProvider(input);
    for (const model of models) await createRuntimeConfigurationModel(provider.id, model);
    return;
  }
  const { runtime } = draft;
  await updateRuntimeConfigurationProvider(runtime.id, input);
  const listed = new Set(models.map((model) => model.model));
  for (const model of runtime.models) {
    if (!listed.has(model.model)) await deleteRuntimeConfigurationModel(model.id);
  }
  const kept = new Set(runtime.models.map((model) => model.model));
  for (const model of models) {
    if (!kept.has(model.model)) await createRuntimeConfigurationModel(runtime.id, model);
  }
};
