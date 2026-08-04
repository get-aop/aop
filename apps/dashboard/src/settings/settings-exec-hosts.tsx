import type { ExecHostConfig, ExecHostUpsert, RuntimeProfile } from "@aop/common";
import { PlusIcon } from "lucide-react";
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
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/ui/field";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Spinner } from "@/ui/spinner";
import {
  type ExecHostTestResult,
  getExecHosts,
  getRuntimeProfiles,
  saveExecHosts,
  testExecHost,
  updateRuntimeProfile,
} from "../api/client";

type HostDraft = {
  id?: string;
  name: string;
  host: string;
  user: string;
  port: string;
  identityFile: string;
  remoteRoot: string;
};

const emptyDraft = (): HostDraft => ({
  name: "",
  host: "",
  user: "",
  port: "",
  identityFile: "",
  remoteRoot: "",
});

const toDraft = (host: ExecHostConfig): HostDraft => ({
  id: host.id,
  name: host.name,
  host: host.host,
  user: host.user ?? "",
  port: host.port !== undefined ? String(host.port) : "",
  identityFile: host.identityFile ?? "",
  remoteRoot: host.remoteRoot,
});

const toConfig = (draft: HostDraft): ExecHostUpsert => {
  const port = draft.port.trim() ? Number(draft.port) : undefined;
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    host: draft.host.trim(),
    ...(draft.user.trim() ? { user: draft.user.trim() } : {}),
    ...(port !== undefined && Number.isFinite(port) ? { port } : {}),
    ...(draft.identityFile.trim() ? { identityFile: draft.identityFile.trim() } : {}),
    remoteRoot: draft.remoteRoot.trim(),
  };
};

/** Settings §Execution hosts — SSH hosts feeding execHostId, on Field rows. */
export const SettingsExecHosts = () => {
  const [hosts, setHosts] = useState<ExecHostConfig[]>([]);
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<HostDraft | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ExecHostTestResult | "loading">>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ExecHostConfig | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextHosts, nextProfiles] = await Promise.all([getExecHosts(), getRuntimeProfiles()]);
      setHosts(nextHosts);
      setProfiles(nextProfiles);
    } catch {
      toast.error("Failed to load execution hosts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persistHosts = async (next: ExecHostUpsert[]) => {
    setSaving(true);
    try {
      setHosts(await saveExecHosts(next));
      setEditing(null);
      toast.success("Hosts saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save hosts");
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.host.trim() || !editing.remoteRoot.trim()) {
      toast.error("Name, host, and remote root are required");
      return;
    }
    const config = toConfig(editing);
    if (config.id) {
      await persistHosts(hosts.map((h) => (h.id === config.id ? config : h)));
    } else {
      await persistHosts([...hosts, config]);
    }
  };

  const removeHost = async (host: ExecHostConfig) => {
    setRemoveTarget(null);
    await persistHosts(hosts.filter((h) => h.id !== host.id));
  };

  const runTest = async (id: string) => {
    setTestResults((prev) => ({ ...prev, [id]: "loading" }));
    try {
      const result = await testExecHost(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          reachable: false,
          latencyMs: null,
          rsync: false,
          git: false,
          clis: [],
          error: err instanceof Error ? err.message : "Test failed",
        },
      }));
    }
  };

  const setProfileHost = async (profileId: string, execHostId: string | undefined) => {
    if (profileId === "__none__") return;
    try {
      const updated = await updateRuntimeProfile(profileId, { execHostId: execHostId ?? "" });
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === updated.id
            ? { ...updated, ...(updated.execHostId ? {} : { execHostId: undefined }) }
            : p,
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update profile host");
    }
  };

  return (
    <div data-testid="section-exec-hosts" className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[13px] font-semibold text-text">Execution hosts</h2>
        <Button variant="secondary" size="sm" onClick={() => setEditing(emptyDraft())}>
          <PlusIcon className="size-3.5" />
          Add host
        </Button>
      </div>
      <p className="text-[12px] text-text-subtle">
        Key-based SSH from this machine only (BatchMode). Install and authenticate agent CLIs on the
        remote host.
      </p>

      {loading ? (
        <p className="py-6 text-center text-[12px] text-text-subtle">Loading hosts…</p>
      ) : hosts.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No execution hosts</EmptyTitle>
            <EmptyDescription>Add an SSH host to run agents remotely.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        hosts.map((host) => (
          <ExecHostRow
            key={host.id}
            host={host}
            profiles={profiles}
            test={testResults[host.id]}
            onTest={() => void runTest(host.id)}
            onEdit={() => setEditing(toDraft(host))}
            onRemove={() => setRemoveTarget(host)}
            onProfileChange={(profileId, execHostId) => void setProfileHost(profileId, execHostId)}
          />
        ))
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="w-[480px]">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit host" : "Add execution host"}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="host-name">Name</FieldLabel>
                <Input
                  id="host-name"
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="host-address">Host</FieldLabel>
                <Input
                  id="host-address"
                  value={editing.host}
                  onChange={(event) => setEditing({ ...editing, host: event.target.value })}
                />
              </Field>
              <div className="flex gap-3">
                <Field className="flex-1">
                  <FieldLabel htmlFor="host-user">User</FieldLabel>
                  <Input
                    id="host-user"
                    value={editing.user}
                    onChange={(event) => setEditing({ ...editing, user: event.target.value })}
                  />
                </Field>
                <Field className="w-24">
                  <FieldLabel htmlFor="host-port">Port</FieldLabel>
                  <Input
                    id="host-port"
                    value={editing.port}
                    onChange={(event) => setEditing({ ...editing, port: event.target.value })}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="host-identity">Identity file</FieldLabel>
                <Input
                  id="host-identity"
                  value={editing.identityFile}
                  onChange={(event) => setEditing({ ...editing, identityFile: event.target.value })}
                />
                <FieldDescription>Optional path to an SSH key.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="host-root">Remote root</FieldLabel>
                <Input
                  id="host-root"
                  value={editing.remoteRoot}
                  onChange={(event) => setEditing({ ...editing, remoteRoot: event.target.value })}
                />
              </Field>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void saveDraft()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent className="w-[512px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove host?</AlertDialogTitle>
            <AlertDialogDescription>
              “{removeTarget?.name}” will stop receiving runs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeTarget && void removeHost(removeTarget)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const ExecHostRow = ({
  host,
  profiles,
  test,
  onTest,
  onEdit,
  onRemove,
  onProfileChange,
}: {
  host: ExecHostConfig;
  profiles: RuntimeProfile[];
  test?: ExecHostTestResult | "loading";
  onTest: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onProfileChange: (profileId: string, execHostId: string | undefined) => void;
}) => (
  <div
    key={host.id}
    data-testid={`exec-host-${host.id}`}
    className="flex min-w-0 items-center gap-3 rounded-row border border-border bg-raised px-3 py-2"
  >
    <div className="min-w-0 flex-1">
      <div className="truncate text-[13px] font-medium text-text">{host.name}</div>
      <div className="truncate font-mono text-[11px] text-text-subtle">
        {host.user ? `${host.user}@` : ""}
        {host.host}
        {host.port !== undefined ? `:${host.port}` : ""} · {host.remoteRoot}
      </div>
      <ExecHostTestStatus hostId={host.id} test={test} />
    </div>
    <Select
      value={profiles.find((p) => p.execHostId === host.id)?.id ?? "__none__"}
      onValueChange={(value) => onProfileChange(value, value === "__none__" ? undefined : host.id)}
    >
      <SelectTrigger size="sm" className="h-7 w-36" aria-label="Run on">
        <SelectValue placeholder="Run on" />
      </SelectTrigger>
      <SelectContent>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            {profile.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    <Button variant="ghost" size="sm" onClick={onTest}>
      Test
    </Button>
    <Button variant="ghost" size="sm" onClick={onEdit}>
      Edit
    </Button>
    <Button
      variant="ghost"
      size="sm"
      data-testid={`remove-exec-host-${host.id}`}
      onClick={onRemove}
    >
      Remove
    </Button>
  </div>
);

const ExecHostTestStatus = ({
  hostId,
  test,
}: {
  hostId: string;
  test?: ExecHostTestResult | "loading";
}) => {
  if (test === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-text-subtle">
        <Spinner className="size-3" /> Testing…
      </span>
    );
  }
  if (!test) return null;
  return (
    <span
      data-testid={`exec-host-test-${hostId}`}
      className={test.reachable ? "text-[11px] text-ok" : "text-[11px] text-blocked"}
    >
      {test.reachable ? "Reachable" : "Unreachable"}
      {test.latencyMs !== null ? ` · ${test.latencyMs}ms` : ""}
      {test.error ? ` · ${test.error}` : ""}
    </span>
  );
};
