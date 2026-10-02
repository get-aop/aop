import type { LinearCatalog, LinearScope } from "@aop/common";
import { ArrowUpRightIcon } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { Spinner } from "@/ui/spinner";
import { LinearMark } from "./source-marks";
import { type LinearSetup, useLinearSetup } from "./use-linear-setup";

const LINEAR_KEYS_URL = "https://linear.app/settings/account/security";

/**
 * Connects the project to Linear: the host owner pastes a personal API key, AOP checks it with
 * Linear and lists the workspace's teams and projects, and the owner picks the one whose issues
 * this project shows. The key is stored on the host only. A paired device sees what is
 * connected, and that only the host owner can change it.
 */
export const LinearConnectDialog = ({
  projectId,
  open,
  owner,
  onOpenChange,
  onChanged,
}: {
  projectId: string;
  open: boolean;
  owner: boolean;
  onOpenChange: (open: boolean) => void;
  /** The connection changed: the issues list reads again. */
  onChanged: () => void;
}) => {
  const setup = useLinearSetup(projectId, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="linear-dialog"
        className="w-[460px] gap-5 border-border-strong bg-overlay"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <LinearMark className="size-4" />
            Linear
          </DialogTitle>
          <DialogDescription className="text-meta leading-relaxed text-text-muted">
            List a Linear team's or project's issues in this project's Issues tab. The API key stays
            on the host: paired devices never receive it.
          </DialogDescription>
        </DialogHeader>
        <Body setup={setup} owner={owner} onDone={onChanged} />
        {setup.error ? (
          <p data-testid="linear-error" role="alert" className="text-meta text-blocked">
            {setup.error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

const Body = ({
  setup,
  owner,
  onDone,
}: {
  setup: LinearSetup;
  owner: boolean;
  onDone: () => void;
}) => {
  const { step } = setup;
  if (step.kind === "loading") {
    return (
      <p className="flex items-center gap-2 text-meta text-text-subtle">
        <Spinner className="size-3.5" /> Checking the connection…
      </p>
    );
  }
  if (step.kind === "connected") return <Connected setup={setup} owner={owner} onDone={onDone} />;
  if (!owner) {
    return (
      <p data-testid="linear-owner-only" className="text-meta text-text-muted">
        Linear is not connected. Only the host owner can connect it, from the dashboard on the host
        machine.
      </p>
    );
  }
  if (step.kind === "key") return <KeyStep setup={setup} />;
  return <ScopeStep setup={setup} catalog={step.catalog} onDone={onDone} />;
};

const Connected = ({
  setup,
  owner,
  onDone,
}: {
  setup: LinearSetup;
  owner: boolean;
  onDone: () => void;
}) => {
  const connection = setup.connection;
  return (
    <div className="flex flex-col gap-4">
      <dl
        data-testid="linear-connected"
        className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-card border border-border-strong bg-raised px-4 py-3 text-meta"
      >
        <dt className="text-text-subtle">Workspace</dt>
        <dd className="text-text">{connection?.workspace || "—"}</dd>
        <dt className="text-text-subtle">
          {connection?.scope?.kind === "project" ? "Project" : "Team"}
        </dt>
        <dd data-testid="linear-scope" className="font-medium text-text">
          {connection?.scope?.name}
        </dd>
        <dt className="text-text-subtle">Key of</dt>
        <dd className="text-text">{connection?.viewer || "—"}</dd>
      </dl>
      {owner ? (
        <DialogFooter className="sm:justify-between">
          <Button
            variant="destructive"
            size="sm"
            data-testid="linear-disconnect"
            disabled={setup.busy}
            onClick={async () => {
              if (await setup.disconnect()) onDone();
            }}
          >
            Disconnect
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              data-testid="linear-replace-key"
              disabled={setup.busy}
              onClick={setup.replaceKey}
            >
              Replace key
            </Button>
            <Button
              size="sm"
              data-testid="linear-change-scope"
              disabled={setup.busy}
              onClick={() => void setup.changeScope()}
            >
              {setup.busy ? <Spinner className="size-3.5" /> : null}
              Change team or project
            </Button>
          </div>
        </DialogFooter>
      ) : (
        <p className="text-meta text-text-subtle">
          Only the host owner can change this, on the host machine.
        </p>
      )}
    </div>
  );
};

const KeyStep = ({ setup }: { setup: LinearSetup }) => {
  const [key, setKey] = useState("");
  const submit = () => {
    if (key.trim()) void setup.checkKey(key.trim());
  };
  return (
    // Not a <form> with a password field: the browser would offer to save the key as a login.
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-meta leading-relaxed text-text-muted marker:text-text-subtle">
        <li>
          In Linear, open{" "}
          <a
            href={LINEAR_KEYS_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-0.5 text-running hover:underline"
          >
            Settings › Security & access
            <ArrowUpRightIcon className="size-3" />
          </a>{" "}
          and create a personal API key (read access is enough).
        </li>
        <li>Paste it here; AOP checks it and lists your teams and projects.</li>
      </ol>
      <div className="flex flex-col gap-2">
        <Label htmlFor="linear-api-key" className="text-meta text-text">
          Personal API key
        </Label>
        <Input
          id="linear-api-key"
          data-testid="linear-api-key"
          type="text"
          // Masked like a password, without being one to the browser's password manager.
          style={{ WebkitTextSecurity: "disc" } as CSSProperties}
          data-1p-ignore
          data-lpignore="true"
          autoComplete="off"
          spellCheck={false}
          placeholder="lin_api_…"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          className="h-9 bg-input-surface font-mono text-meta md:text-meta"
          autoFocus
        />
      </div>
      <DialogFooter>
        {setup.connection?.configured ? (
          <Button type="button" variant="ghost" size="sm" onClick={setup.back}>
            Back
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          data-testid="linear-check-key"
          onClick={submit}
          disabled={!key.trim() || setup.busy}
        >
          {setup.busy ? <Spinner className="size-3.5" /> : null}
          Continue
        </Button>
      </DialogFooter>
    </div>
  );
};

const ScopeStep = ({
  setup,
  catalog,
  onDone,
}: {
  setup: LinearSetup;
  catalog: LinearCatalog;
  onDone: () => void;
}) => {
  const options = scopeOptions(catalog);
  const current = setup.connection?.scope;
  const [picked, setPicked] = useState<string>(
    current ? `${current.kind}:${current.id}` : options[0] ? keyOf(options[0]) : "",
  );
  const scope = options.find((option) => keyOf(option) === picked);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-meta text-text-muted">
        Signed in to <span className="text-text">{catalog.workspace}</span> as{" "}
        <span className="text-text">{catalog.viewer}</span>. Which issues should this project show?
      </p>
      <div
        role="radiogroup"
        aria-label="Linear team or project"
        data-testid="linear-scopes"
        className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-card border border-border-strong bg-raised p-1"
      >
        {options.length === 0 ? (
          <p className="px-3 py-2 text-meta text-text-subtle">This key sees no team or project.</p>
        ) : null}
        {(["team", "project"] as const).map((kind) =>
          options.some((option) => option.kind === kind) ? (
            <div key={kind} className="flex flex-col gap-0.5">
              <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-text-subtle">
                {kind === "team" ? "Teams" : "Projects"}
              </p>
              {options
                .filter((option) => option.kind === kind)
                .map((option) => (
                  <button
                    key={keyOf(option)}
                    type="button"
                    role="radio"
                    aria-checked={picked === keyOf(option)}
                    data-testid="linear-scope-option"
                    data-scope={keyOf(option)}
                    onClick={() => setPicked(keyOf(option))}
                    className="flex items-center gap-2.5 rounded-row px-2.5 py-1.5 text-left text-meta text-text-muted hover:bg-hover aria-checked:bg-active aria-checked:text-text"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-3.5 shrink-0 place-items-center rounded-full border border-border-bold"
                    >
                      {picked === keyOf(option) ? (
                        <span className="size-1.5 rounded-full bg-text" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                    {option.hint ? (
                      <span className="text-[11px] text-text-subtle">{option.hint}</span>
                    ) : null}
                  </button>
                ))}
            </div>
          ) : null,
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={setup.back}>
          Back
        </Button>
        <Button
          size="sm"
          data-testid="linear-save"
          disabled={!scope || setup.busy}
          onClick={async () => {
            if (scope && (await setup.save({ kind: scope.kind, id: scope.id, name: scope.name })))
              onDone();
          }}
        >
          {setup.busy ? <Spinner className="size-3.5" /> : null}
          Connect
        </Button>
      </DialogFooter>
    </div>
  );
};

type ScopeOption = LinearScope & { hint: string | null };

const scopeOptions = (catalog: LinearCatalog): ScopeOption[] => [
  ...catalog.teams.map((team) => ({
    kind: "team" as const,
    id: team.id,
    name: team.name,
    hint: team.key,
  })),
  ...catalog.projects.map((project) => ({
    kind: "project" as const,
    id: project.id,
    name: project.name,
    hint: project.teams.join(", ") || null,
  })),
];

const keyOf = (scope: LinearScope): string => `${scope.kind}:${scope.id}`;
