import { type AppUpdateState, buildChannel } from "@aop/common";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { DesktopBackend, DesktopState } from "../backend/types";
import { Brand, Notice } from "../ui";
import { AppUpdateRow } from "./AppUpdateRow";

interface ConnectScreenProps {
  state: DesktopState;
  backend: DesktopBackend;
  update: AppUpdateState | null;
  /** Shown when the app already has a host to go back to (Change Host…). */
  onBack: (() => void) | null;
  onManageLocalHost: () => void;
}

/**
 * Connect to a host: first run, and Change Host… later. This Mac, where the app bundles a host,
 * or another computer that runs AOP: its address and a one-time pairing code. The app pairs,
 * keeps the token in the operating system's keychain, and opens the dashboard.
 */
export const ConnectScreen = ({
  state,
  backend,
  update,
  onBack,
  onManageLocalHost,
}: ConnectScreenProps) => {
  const removed = state.mode === "remote" && state.connection.status === "unauthorized";
  return (
    <main className="screen" data-testid="connect-screen">
      <div className="card">
        <Brand
          title="Connect to a host"
          subtitle="The host keeps your projects and runs the agents. This app is a window onto it."
        />

        {removed ? (
          <Notice tone="warning" testId="connect-removed">
            This host no longer accepts this device. Get a new pairing code on the host.
          </Notice>
        ) : null}

        {state.hostModeAvailable ? (
          <section className="choice" data-testid="connect-this-mac" aria-labelledby="this-mac">
            <h2 id="this-mac">This Mac</h2>
            <p className="muted">Run AOP here. Other devices can connect to it later.</p>
            <div className="actions">
              <button
                type="button"
                className="button"
                data-testid="connect-run-local"
                onClick={onManageLocalHost}
              >
                Set up this Mac
              </button>
            </div>
          </section>
        ) : null}

        <AnotherComputer state={state} backend={backend} />

        <AppUpdateRow state={state} update={update} backend={backend} />

        {onBack ? (
          <div className="actions">
            <button type="button" className="button" data-testid="connect-back" onClick={onBack}>
              Back
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
};

const AnotherComputer = ({ state, backend }: { state: DesktopState; backend: DesktopBackend }) => {
  const [url, setUrl] = useState(state.remoteUrl ?? "");
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState(state.defaultDeviceName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const urlField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    urlField.current?.focus();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await backend.connectHost({ url, code, deviceName });
      // On success the window moves on to the dashboard; there is nothing left to show here.
      if (!result.ok) {
        setError(result.message);
        setPending(false);
      }
    } catch {
      setError("The app could not reach its own connection service. Restart it and try again.");
      setPending(false);
    }
  };

  return (
    <form
      className="choice"
      data-testid="connect-another-computer"
      aria-labelledby="another-computer"
      onSubmit={(event) => void submit(event)}
    >
      <h2 id="another-computer">Another computer</h2>
      <p className="muted">A Mac or Linux computer that runs AOP.</p>
      <div className="field">
        <label htmlFor="connect-url">Address</label>
        <input
          id="connect-url"
          data-testid="connect-url"
          ref={urlField}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://soulf.tail1234.ts.net:25650"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="connect-code">Pairing code</label>
        <input
          id="connect-code"
          data-testid="connect-code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={32}
          placeholder="K7QM-4XNP"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
      </div>
      <details data-testid="connect-name">
        <summary>Name this computer</summary>
        <div className="field">
          <label htmlFor="connect-device-name">The host lists this computer as</label>
          <input
            id="connect-device-name"
            data-testid="connect-device-name"
            autoComplete="off"
            maxLength={100}
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
          />
        </div>
      </details>

      {error ? (
        <Notice tone="error" testId="connect-error">
          {error}
        </Notice>
      ) : null}

      <div className="actions">
        <button
          type="submit"
          className="button button-primary"
          data-testid="connect-submit"
          disabled={pending || url.trim() === "" || code.trim() === "" || deviceName.trim() === ""}
        >
          {pending ? "Connecting…" : "Connect"}
        </button>
      </div>
      <p className="subtle" data-testid="connect-pairing-help">
        Get a code on the host: AOP settings › Host › Pair a device, or run{" "}
        <code>{buildChannel().binaryName} pair</code> there. Any device already paired can also make
        one.
      </p>
    </form>
  );
};
