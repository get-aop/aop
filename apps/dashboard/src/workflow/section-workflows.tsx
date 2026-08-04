import { getWorkflowThinkingOptions, runtimeConfigurationSupportsFastMode } from "@aop/common";
import {
  ChevronDownIcon,
  EllipsisIcon,
  GripVerticalIcon,
  PlusIcon,
  RouteIcon,
  ZapIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Separator } from "@/ui/separator";
import {
  deleteWorkflow,
  getWorkflowDetails,
  saveWorkflow,
  type WorkflowSummary,
} from "../api/client";
import { useRuntimeConfiguration } from "../hooks/runtime-configuration";
import { isRunnableRuntimeConfiguration } from "../runtime-configuration-selection";
import {
  compileSimpleWorkflow,
  decompileSimpleWorkflow,
  SIMPLE_STEP_KINDS,
  type SimpleWorkflow,
  type SimpleWorkflowStep,
} from "./simple-workflow";
import { STEP_KIND_ICONS, STEP_KIND_LABELS, WorkflowGlyphSequence } from "./workflow-glyphs";

const DEFAULT_WORKFLOW_ID = "aop-default-gpt";

const SEED_SHIP_IT: SimpleWorkflow = {
  name: "Ship it",
  steps: [
    {
      kind: "implement",
      agent: { provider: "codex-cli", model: "gpt-5.6-sol", reasoning: "high", fastMode: true },
    },
    {
      kind: "code-review",
      agent: { provider: "claude-code", model: "opus-4.8", reasoning: "max" },
    },
    {
      kind: "test",
      agent: { provider: "codex-cli", model: "gpt-5.5", reasoning: "medium", fastMode: true },
    },
  ],
};

interface EditingWorkflow {
  source?: WorkflowSummary;
  name: string;
  steps: SimpleWorkflowStep[];
}

/** Settings §Workflows — list + inline expand-to-edit (PLAN §6.4). */
export const SectionWorkflows = ({ onChanged }: { onChanged?: () => void }) => {
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [editing, setEditing] = useState<EditingWorkflow | null>(null);
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const { providers } = useRuntimeConfiguration();
  const runnableProviders = providers.filter(isRunnableRuntimeConfiguration);

  const reload = useCallback(async () => {
    const list = await getWorkflowDetails();
    setWorkflows(list);
    if (!seeded && list.length === 0) {
      setSeeded(true);
      await saveWorkflow({
        name: SEED_SHIP_IT.name,
        steps: compileSimpleWorkflow(SEED_SHIP_IT),
      });
      toast.success("Seeded the “Ship it” workflow");
      setWorkflows(await getWorkflowDetails());
    }
  }, [seeded]);

  useEffect(() => {
    void reload().catch(() => setWorkflows([]));
  }, [reload]);

  const setDefault = async (workflowId: string) => {
    try {
      await saveWorkflow({ sourceWorkflowId: workflowId, name: "aop-default-gpt" });
      onChanged?.();
      void reload();
    } catch {
      toast.error("Could not set the default workflow");
    }
  };

  const duplicate = async (workflow: WorkflowSummary) => {
    try {
      await saveWorkflow({ sourceWorkflowId: workflow.id, name: `${workflow.name} copy` });
      void reload();
    } catch {
      toast.error("Could not duplicate the workflow");
    }
  };

  const remove = async (workflowId: string) => {
    try {
      await deleteWorkflow(workflowId);
      void reload();
    } catch {
      toast.error("Could not delete the workflow");
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const steps = compileSimpleWorkflow({ name: editing.name, steps: editing.steps });
      await saveWorkflow({
        ...(editing.source ? { sourceWorkflowId: editing.source.id } : {}),
        name: editing.name,
        steps,
      });
      toast.success("Workflow saved");
      setEditing(null);
      void reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the workflow");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="section-workflows" className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <RouteIcon className="size-4 text-text-subtle" strokeWidth={1.7} />
        <h2 className="text-[13px] font-semibold text-text">Workflows</h2>
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={() => setEditing({ name: "", steps: [] })}
        >
          <PlusIcon className="size-3.5" />
          New workflow
        </Button>
      </div>
      <p className="text-[12px] text-text-subtle">
        Ordered steps from a fixed catalog — Implement, Code review, Test, Browser check. Failures
        self-heal with generated debug/fix helpers.
      </p>
      <Separator className="my-1" />

      {editing ? (
        <WorkflowEditor
          editing={editing}
          setEditing={setEditing}
          runnableProviders={runnableProviders.map((p) => ({
            id: p.id,
            name: p.name,
            driver: p.driver,
            models: p.models.map((m) => ({
              model: m.model,
              label: m.description.trim() || m.model,
            })),
          }))}
          saving={saving}
          onSave={() => void saveEdit()}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {workflows === null ? (
        <p className="py-6 text-center text-[12px] text-text-subtle">Loading workflows…</p>
      ) : workflows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No workflows yet</EmptyTitle>
            <EmptyDescription>Create one or reopen Settings to seed “Ship it”.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        workflows.map((workflow) => {
          const simple = decompileSimpleWorkflow(workflow);
          return (
            <div
              key={workflow.id}
              data-testid="workflow-row"
              className="flex min-w-0 items-center gap-2 rounded-row border border-border bg-raised px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
                {workflow.name}
              </span>
              <WorkflowGlyphSequence workflow={workflow} />
              {workflow.id === DEFAULT_WORKFLOW_ID ? (
                <Badge variant="tag">Default</Badge>
              ) : simple ? null : (
                <Badge variant="tag">Legacy</Badge>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-testid="workflow-row-menu"
                    aria-label={`Actions for ${workflow.name}`}
                    className="grid size-6 shrink-0 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
                  >
                    <EllipsisIcon className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => void setDefault(workflow.id)}
                    disabled={workflow.id === DEFAULT_WORKFLOW_ID}
                  >
                    Set default
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void duplicate(workflow)}>
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      setEditing({
                        source: workflow,
                        name: workflow.name,
                        steps: simple?.steps ?? [],
                      })
                    }
                    disabled={!simple}
                  >
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => void remove(workflow.id)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })
      )}
    </div>
  );
};

const WorkflowEditor = ({
  editing,
  setEditing,
  runnableProviders,
  saving,
  onSave,
  onCancel,
}: {
  editing: EditingWorkflow;
  setEditing: (next: EditingWorkflow) => void;
  runnableProviders: Array<{
    id: string;
    name: string;
    driver: string;
    models: Array<{ model: string; label: string }>;
  }>;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) => {
  const patchStep = (index: number, patch: Partial<SimpleWorkflowStep>) => {
    setEditing({
      ...editing,
      steps: editing.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    });
  };

  const patchAgent = (index: number, patch: Partial<SimpleWorkflowStep["agent"]>) => {
    patchStep(index, { agent: { ...editing.steps[index]!.agent, ...patch } });
  };

  const providerFor = (step: SimpleWorkflowStep) =>
    runnableProviders.find((p) => p.driver === step.agent.provider) ?? runnableProviders[0] ?? null;

  return (
    <div
      data-testid="workflow-editor"
      className="flex flex-col gap-2 rounded-card border border-border-strong bg-surface p-3"
    >
      <InputGroup>
        <InputGroupAddon>
          <RouteIcon className="size-3.5" />
        </InputGroupAddon>
        <InputGroupInput
          placeholder="Workflow name"
          value={editing.name}
          onChange={(event) => setEditing({ ...editing, name: event.target.value })}
        />
      </InputGroup>

      <div className="flex flex-col gap-1.5">
        {editing.steps.map((step, index) => {
          const provider = providerFor(step);
          const modelOptions = provider?.models ?? [];
          const effortOptions = getWorkflowThinkingOptions(step.agent.provider, step.agent.model);
          return (
            <div
              key={`${index}-${step.kind}`}
              data-testid="workflow-editor-step"
              className="flex items-center gap-2 rounded-row border border-border bg-raised px-2 py-1.5"
            >
              <GripVerticalIcon className="size-3.5 shrink-0 text-text-subtle" />
              <span className="flex w-28 shrink-0 items-center gap-1.5 text-[12.5px] text-text">
                {(() => {
                  const Icon = STEP_KIND_ICONS[step.kind];
                  return <Icon className="size-3.5 shrink-0" strokeWidth={1.7} />;
                })()}
                {STEP_KIND_LABELS[step.kind]}
              </span>
              <Select
                value={step.agent.provider}
                onValueChange={(value) =>
                  patchAgent(index, { provider: value as SimpleWorkflowStep["agent"]["provider"] })
                }
              >
                <SelectTrigger size="sm" className="h-7 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {runnableProviders.map((p) => (
                    <SelectItem key={p.id} value={p.driver}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={step.agent.model}
                onValueChange={(value) => patchAgent(index, { model: value })}
              >
                <SelectTrigger size="sm" className="h-7 min-w-0 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((m) => (
                    <SelectItem key={m.model} value={m.model}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={step.agent.reasoning}
                onValueChange={(value) =>
                  patchAgent(index, {
                    reasoning: value as SimpleWorkflowStep["agent"]["reasoning"],
                  })
                }
              >
                <SelectTrigger size="sm" className="h-7 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {effortOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {runtimeConfigurationSupportsFastMode(
                { driver: step.agent.provider, builtIn: true, supportsFastMode: false },
                step.agent.model,
              ) ? (
                <button
                  type="button"
                  data-testid="workflow-editor-fast"
                  aria-pressed={step.agent.fastMode === true}
                  onClick={() => patchAgent(index, { fastMode: step.agent.fastMode !== true })}
                  className="grid size-6 shrink-0 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
                >
                  <ZapIcon
                    className={step.agent.fastMode ? "size-3.5 text-favorite" : "size-3.5"}
                  />
                </button>
              ) : null}
              <button
                type="button"
                aria-label={`Remove ${STEP_KIND_LABELS[step.kind]} step`}
                onClick={() =>
                  setEditing({ ...editing, steps: editing.steps.filter((_, i) => i !== index) })
                }
                className="grid size-6 shrink-0 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
              >
                <ChevronDownIcon className="size-3.5 rotate-180" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" disabled={editing.steps.length >= 8}>
              <PlusIcon className="size-3.5" />
              Add step
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {SIMPLE_STEP_KINDS.map((kind) => (
              <DropdownMenuItem
                key={kind}
                disabled={editing.steps.length >= 8}
                onSelect={() => {
                  const defaultProvider = runnableProviders[0];
                  if (!defaultProvider) return;
                  const firstModel = defaultProvider.models[0];
                  if (!firstModel) return;
                  setEditing({
                    ...editing,
                    steps: [
                      ...editing.steps,
                      {
                        kind,
                        agent: {
                          provider:
                            defaultProvider.driver as SimpleWorkflowStep["agent"]["provider"],
                          model: firstModel.model,
                          reasoning: "medium",
                        },
                      },
                    ],
                  });
                }}
              >
                {(() => {
                  const Icon = STEP_KIND_ICONS[kind];
                  return <Icon className="size-3.5" strokeWidth={1.7} />;
                })()}
                {STEP_KIND_LABELS[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-[11px] text-text-subtle">
          Failed steps self-heal: a generated debug/fix helper retries automatically.
        </span>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving || editing.name.trim().length === 0}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
};
