import type { JiraCredentials, JiraDeployment } from "@aop/common";
import { ArrowUpRightIcon, CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { type CSSProperties, type FormEvent, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { DialogFooter } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { Spinner } from "@/ui/spinner";
import { fingerprint, type JiraSetup } from "./use-jira-setup";

const CLOUD_TOKENS_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

const DEPLOYMENTS: { id: JiraDeployment; label: string }[] = [
  { id: "cloud", label: "Jira Cloud" },
  { id: "datacenter", label: "Data Center / Server" },
];

/**
 * Where the project's Jira is and how AOP signs in: Jira Cloud with the account's email and an
 * API token, Data Center or Server with a personal access token. Test connection signs in and
 * names the account; Continue is offered for exactly the values that test passed with.
 */
export const JiraCredentialsStep = ({ setup }: { setup: JiraSetup }) => {
  const [deployment, setDeployment] = useState<JiraDeployment>(
    setup.connection?.deployment ?? "cloud",
  );
  const [siteUrl, setSiteUrl] = useState(setup.connection?.siteUrl ?? "");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const credentials = credentialsOf(deployment, siteUrl, email, token);
  const tested = passedTest(setup, credentials);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!credentials) return;
    if (tested) setup.continueWithTested(credentials);
    else void setup.testConnection(credentials);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DeploymentPicker value={deployment} onChange={setDeployment} />
      <Field id="jira-site" label="Site address">
        <Input
          id="jira-site"
          data-testid="jira-site"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={PLACEHOLDER[deployment]}
          value={siteUrl}
          onChange={(event) => setSiteUrl(event.target.value)}
          className={FIELD}
          autoFocus
        />
      </Field>
      {deployment === "cloud" ? (
        <Field id="jira-email" label="Account email">
          <Input
            id="jira-email"
            data-testid="jira-email"
            type="email"
            autoComplete="off"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={FIELD}
          />
        </Field>
      ) : null}
      <TokenField deployment={deployment} value={token} onChange={setToken} />
      <TestOutcome setup={setup} stale={setup.test?.ok === true && !tested} />
      <Footer setup={setup} credentials={credentials} tested={tested} />
    </form>
  );
};

const PLACEHOLDER: Record<JiraDeployment, string> = {
  cloud: "https://your-team.atlassian.net",
  datacenter: "https://jira.example.com",
};

/** Whether Test connection passed with exactly these credentials. */
const passedTest = (setup: JiraSetup, credentials: JiraCredentials | null): boolean =>
  setup.test?.ok === true && credentials !== null && setup.test.tested === fingerprint(credentials);

const DeploymentPicker = ({
  value,
  onChange,
}: {
  value: JiraDeployment;
  onChange: (deployment: JiraDeployment) => void;
}) => (
  <fieldset
    aria-label="Jira deployment"
    className="m-0 grid min-w-0 grid-cols-2 gap-1 rounded-row border border-border-strong bg-raised p-1"
  >
    {DEPLOYMENTS.map((option) => (
      <label
        key={option.id}
        data-testid={`jira-deployment-${option.id}`}
        className="flex h-7 cursor-pointer items-center justify-center rounded-[6px] text-meta text-text-muted hover:text-text has-[:checked]:bg-active has-[:checked]:text-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-running"
      >
        <input
          type="radio"
          name="jira-deployment"
          value={option.id}
          checked={value === option.id}
          onChange={() => onChange(option.id)}
          className="sr-only"
        />
        {option.label}
      </label>
    ))}
  </fieldset>
);

const TokenField = ({
  deployment,
  value,
  onChange,
}: {
  deployment: JiraDeployment;
  value: string;
  onChange: (token: string) => void;
}) => (
  <Field
    id="jira-token"
    label={deployment === "cloud" ? "API token" : "Personal access token"}
    hint={<TokenHint deployment={deployment} />}
  >
    <Input
      id="jira-token"
      data-testid="jira-token"
      type="text"
      // Masked like a password without being a password field, which the browser would
      // offer to save as a login.
      style={{ WebkitTextSecurity: "disc" } as CSSProperties}
      data-1p-ignore
      data-lpignore="true"
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(FIELD, "font-mono")}
    />
  </Field>
);

const Footer = ({
  setup,
  credentials,
  tested,
}: {
  setup: JiraSetup;
  credentials: JiraCredentials | null;
  tested: boolean;
}) => (
  <DialogFooter className="sm:justify-between">
    {setup.connection?.configured ? (
      <Button type="button" variant="ghost" size="sm" data-testid="jira-back" onClick={setup.back}>
        Back
      </Button>
    ) : (
      <span />
    )}
    <div className="flex gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        data-testid="jira-test"
        disabled={!credentials || setup.busy}
        onClick={() => credentials && void setup.testConnection(credentials)}
      >
        {setup.busy ? <Spinner className="size-3.5" /> : null}
        Test connection
      </Button>
      <Button type="submit" size="sm" data-testid="jira-continue" disabled={!tested || setup.busy}>
        Continue
      </Button>
    </div>
  </DialogFooter>
);

const FIELD = "h-9 bg-input-surface text-meta md:text-meta";

const Field = ({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={id} className="text-meta text-text">
      {label}
    </Label>
    {children}
    {hint ? <p className="text-[11.5px] leading-relaxed text-text-subtle">{hint}</p> : null}
  </div>
);

const TokenHint = ({ deployment }: { deployment: JiraDeployment }) =>
  deployment === "cloud" ? (
    <>
      Create one at{" "}
      <a
        href={CLOUD_TOKENS_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-0.5 text-running hover:underline"
      >
        Atlassian account › Security › API tokens
        <ArrowUpRightIcon className="size-3" />
      </a>
      . It stays on the host.
    </>
  ) : (
    <>In Jira, open your profile › Personal Access Tokens and create one. It stays on the host.</>
  );

/** Who the token signed in as, or why it did not, under the fields. */
const TestOutcome = ({ setup, stale }: { setup: JiraSetup; stale: boolean }) => {
  const outcome = setup.test;
  if (!outcome) return null;
  if (outcome.ok) {
    return (
      <p
        data-testid="jira-test-ok"
        className={cn("flex items-center gap-2 text-meta", stale ? "text-text-subtle" : "text-ok")}
      >
        <CircleCheckIcon className="size-3.5 shrink-0" />
        {stale
          ? "The fields changed since the test: test again to continue."
          : `Signed in as ${outcome.account.displayName}${outcome.account.email ? ` (${outcome.account.email})` : ""}.`}
      </p>
    );
  }
  return (
    <p
      data-testid="jira-test-failed"
      role="alert"
      className="flex items-start gap-2 text-meta text-blocked"
    >
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
      {outcome.refused
        ? "Jira refused these credentials. Check the email and token (tokens expire), then test again."
        : outcome.message}
    </p>
  );
};

const credentialsOf = (
  deployment: JiraDeployment,
  siteUrl: string,
  email: string,
  token: string,
): JiraCredentials | null => {
  const site = siteUrl.trim().replace(/\/+$/, "");
  if (!site || !token.trim()) return null;
  if (deployment === "datacenter") return { deployment, siteUrl: site, token: token.trim() };
  return email.trim()
    ? { deployment, siteUrl: site, email: email.trim(), apiToken: token.trim() }
    : null;
};
