import {
  SLACK_OAUTH_CALLBACK_PATH,
  SLACK_USER_EVENTS,
  slackAppManifestYaml,
  slackCreateAppUrl,
} from "@aop/common";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { getHostConfig } from "../../api/host";
import { beginSlackSignIn, connectSlack, importSlackTokens } from "../../api/inbox";
import { openExternalUrl } from "../../api/settings";
import { LabeledField } from "../../inbox/fields";
import { SlackTest } from "./SlackTest";

/**
 * Connect Slack, the private way: the person creates their own app from AOP's manifest (Socket
 * Mode and PKCE already on), pastes its Client ID and its app-level token, and clicks Allow in
 * Slack. The host signs them in with PKCE, so no secret is held anywhere and nothing passes
 * through a server of AOP's. Pasting the two tokens by hand stays as the other way in.
 */
export const SlackSetup = ({
  importAvailable,
  onWaiting,
  onConnected,
}: {
  importAvailable: boolean;
  /** The person is in Slack clicking Allow: the page watches for the connection. */
  onWaiting: (waiting: boolean) => void;
  onConnected: () => void;
}) => {
  const redirectUrl = `${getHostConfig().baseUrl ?? window.location.origin}${SLACK_OAUTH_CALLBACK_PATH}`;
  return (
    <div data-testid="slack-setup" className="flex flex-col gap-5">
      <p className="text-[12.5px] text-text-muted">
        AOP reads your Slack through a small app that only you install, in your own workspace.
        Nothing goes through a server of ours.
      </p>
      {importAvailable ? <ImportBanner onConnected={onConnected} /> : null}
      <Step number={1} title="Create the Slack app">
        <CreateApp redirectUrl={redirectUrl} />
      </Step>
      <Step number={2} title="Sign in with Slack">
        <SignIn redirectUrl={redirectUrl} onWaiting={onWaiting} />
      </Step>
      <PasteTokens onConnected={onConnected} />
    </div>
  );
};

const Step = ({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) => (
  <section className="flex gap-3">
    <span className="grid size-5 shrink-0 place-items-center rounded-full border border-border-strong text-[11px] text-text-muted">
      {number}
    </span>
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-text">{title}</h2>
      {children}
    </div>
  </section>
);

const ImportBanner = ({ onConnected }: { onConnected: () => void }) => {
  const [busy, setBusy] = useState(false);
  return (
    <div
      data-testid="slack-import"
      className="flex flex-wrap items-center gap-3 rounded-row border border-border bg-raised px-3 py-2.5"
    >
      <p className="min-w-0 flex-1 text-[12.5px] text-text">
        This host still has the tokens of your earlier Slack connection test. Use them instead of
        setting up again? The test's folder is deleted once they are saved.
      </p>
      <Button
        type="button"
        size="sm"
        data-testid="slack-import-use"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await importSlackTokens();
            toast.success("Slack connected with your earlier tokens");
            onConnected();
          } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : "Could not import the tokens");
          } finally {
            setBusy(false);
          }
        }}
      >
        Use them
      </Button>
    </div>
  );
};

const CreateApp = ({ redirectUrl }: { redirectUrl: string }) => {
  const manifest = slackAppManifestYaml([redirectUrl]);
  return (
    <>
      <p className="text-[12.5px] text-text-muted">
        Slack opens "Create an app" with AOP's manifest filled in. Pick your workspace and click
        Create. Socket Mode and sign-in are already on; Allow in the next step installs it.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          data-testid="slack-create-app"
          onClick={() => openExternalUrl(slackCreateAppUrl([redirectUrl]))}
        >
          Open Slack
          <ExternalLinkIcon />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="slack-copy-manifest"
          onClick={() =>
            void navigator.clipboard
              .writeText(manifest)
              .then(() => toast.success("Manifest copied"))
          }
        >
          <CopyIcon />
          Copy manifest
        </Button>
      </div>
      <details className="text-[12px] text-text-subtle">
        <summary className="cursor-pointer text-text-muted">
          Setting the app up by hand instead?
        </summary>
        <ol className="mt-1.5 list-decimal space-y-1 pl-5">
          <li>
            Settings › Socket Mode › turn it on (this makes the app-level token, scope
            connections:write).
          </li>
          <li>
            Event Subscriptions › Enable Events, then under "Subscribe to events on behalf of users"
            add {SLACK_USER_EVENTS.join(", ")}, and Save.
          </li>
          <li>
            OAuth & Permissions › add the 13 User Token Scopes from the manifest, and this Redirect
            URL: {redirectUrl}
          </li>
          <li>Install, or Reinstall if Slack asks.</li>
        </ol>
        <p className="mt-1.5">
          If Event Subscriptions asks for a Request URL, Socket Mode is off: go back to the first
          step.
        </p>
      </details>
    </>
  );
};

const SignIn = ({
  redirectUrl,
  onWaiting,
}: {
  redirectUrl: string;
  onWaiting: (waiting: boolean) => void;
}) => {
  const [clientId, setClientId] = useState("");
  const [appToken, setAppToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  const allow = async () => {
    setError(null);
    try {
      const url = await beginSlackSignIn({
        clientId: clientId.trim(),
        appToken: appToken.trim(),
        redirectUrl,
      });
      openExternalUrl(url);
      setWaiting(true);
      onWaiting(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void allow();
      }}
    >
      <p className="text-[12.5px] text-text-muted">
        From your app's Basic Information page: the Client ID (under App Credentials; it is not a
        secret) and an app-level token (App-Level Tokens › Generate Token and Scopes, with the scope
        connections:write). The app-level token is the one key you paste; your user token comes from
        Slack when you click Allow.
      </p>
      <LabeledField label="Client ID">
        {(id) => (
          <Input
            id={id}
            data-testid="slack-client-id"
            placeholder="1234567890.1234567890"
            autoComplete="off"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          />
        )}
      </LabeledField>
      <LabeledField label="App-level token (starts with xapp-)">
        {(id) => (
          <Input
            id={id}
            data-testid="slack-app-token"
            type="password"
            placeholder="xapp-…"
            autoComplete="off"
            value={appToken}
            onChange={(event) => setAppToken(event.target.value)}
          />
        )}
      </LabeledField>
      {error ? (
        <p role="alert" data-testid="slack-sign-in-error" className="text-[12.5px] text-blocked">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          data-testid="slack-allow"
          disabled={!clientId.trim() || !appToken.trim()}
        >
          Allow in Slack
          <ExternalLinkIcon />
        </Button>
        {waiting ? (
          <span data-testid="slack-waiting" className="text-[12.5px] text-text-muted">
            Waiting for you to click Allow in Slack…
          </span>
        ) : null}
      </div>
      <p className="text-[11.5px] text-text-subtle">
        Slack sends you back to this host: {redirectUrl}
      </p>
    </form>
  );
};

/** The other way in: both tokens pasted, tested, then saved. */
const PasteTokens = ({ onConnected }: { onConnected: () => void }) => {
  const [userToken, setUserToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [passed, setPassed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokens = { userToken: userToken.trim(), appToken: appToken.trim() };
  const key = `${tokens.userToken}|${tokens.appToken}`;
  return (
    <details data-testid="slack-paste" className="flex flex-col gap-2">
      <summary className="cursor-pointer text-[12.5px] text-text-muted">
        Paste the two tokens instead
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <LabeledField label="User OAuth Token (OAuth & Permissions, starts with xoxp-)">
          {(id) => (
            <Input
              id={id}
              data-testid="slack-user-token"
              type="password"
              autoComplete="off"
              value={userToken}
              onChange={(event) => setUserToken(event.target.value)}
            />
          )}
        </LabeledField>
        <LabeledField label="App-level token (Basic Information › App-Level Tokens, starts with xapp-)">
          {(id) => (
            <Input
              id={id}
              data-testid="slack-paste-app-token"
              type="password"
              autoComplete="off"
              value={appToken}
              onChange={(event) => setAppToken(event.target.value)}
            />
          )}
        </LabeledField>
        {tokens.userToken && tokens.appToken ? (
          <SlackTest tokens={tokens} onPassed={() => setPassed(key)} />
        ) : null}
        {error ? (
          <p role="alert" className="text-[12.5px] text-blocked">
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          data-testid="slack-save"
          className="self-start"
          disabled={passed !== key}
          title={passed === key ? undefined : "Test these tokens first"}
          onClick={async () => {
            try {
              await connectSlack(tokens);
              toast.success("Slack connected");
              onConnected();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          Save and start
        </Button>
        <p className="text-[11.5px] text-text-subtle">
          Tokens stay on the host, in a file only its user can read. No device can read them back.
        </p>
      </div>
    </details>
  );
};
