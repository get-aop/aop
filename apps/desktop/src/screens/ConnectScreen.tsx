import { type FormEvent, useEffect, useRef, useState } from "react";
import type { DesktopBackend, DesktopState } from "../backend/types";
import { Brand, Notice } from "../ui";

interface ConnectScreenProps {
  state: DesktopState;
  backend: DesktopBackend;
  /** Shown when the app already has a host to go back to. */
  onBack: (() => void) | null;
  onManageLocalHost: () => void;
}

/**
 * First run, and "Change host": the address of the host and the one-time code it shows. The app
 * pairs, keeps the token in the operating system's keychain, and opens the dashboard.
 */
export const ConnectScreen = ({
  state,
  backend,
  onBack,
  onManageLocalHost,
}: ConnectScreenProps) => {
  const [url, setUrl] = useState(state.remoteUrl ?? "");
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState(state.defaultDeviceName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const removed = state.mode === "remote" && state.connection.status === "unauthorized";
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
    <main className="screen" data-testid="connect-screen">
      <form className="card" onSubmit={(event) => void submit(event)}>
        <Brand
          title="Connect to your AOP host"
          subtitle="Your projects, threads and memory live on one host: a Mac or Linux computer of yours. This app is a window onto it."
        />

        {removed ? (
          <Notice tone="warning" testId="connect-removed">
            This host no longer accepts this device. Ask it for a new pairing code.
          </Notice>
        ) : null}

        <div className="stack">
          <div className="field">
            <label htmlFor="connect-url">Host address</label>
            <input
              id="connect-url"
              data-testid="connect-url"
              ref={urlField}
              autoComplete="off"
              spellCheck={false}
              placeholder="https://mac.tail1234.ts.net"
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
          <div className="field">
            <label htmlFor="connect-device-name">Name of this computer</label>
            <input
              id="connect-device-name"
              data-testid="connect-device-name"
              autoComplete="off"
              maxLength={100}
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
            />
          </div>
        </div>

        <details>
          <summary>Where do I get a pairing code?</summary>
          <div className="stack">
            <p className="muted">
              On the host, ask for a one-time code. It works once and expires after ten minutes.
            </p>
            <code className="command" data-testid="connect-pairing-command">
              curl -s -X POST http://127.0.0.1:25150/api/auth/pairing-codes
            </code>
            <p className="subtle">
              The address is the one `tailscale serve` shows, starting with https://. See
              docs/HOST.md.
            </p>
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
            disabled={
              pending || url.trim() === "" || code.trim() === "" || deviceName.trim() === ""
            }
          >
            {pending ? "Connecting…" : "Connect"}
          </button>
          {state.hostModeAvailable ? (
            <button
              type="button"
              className="button"
              data-testid="connect-run-local"
              onClick={onManageLocalHost}
            >
              Run AOP on this Mac instead
            </button>
          ) : null}
          {onBack ? (
            <button type="button" className="button" data-testid="connect-back" onClick={onBack}>
              Back
            </button>
          ) : null}
        </div>
      </form>
    </main>
  );
};
