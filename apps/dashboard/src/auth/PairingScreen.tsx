import { buildChannel, type ChannelConfig } from "@aop/common";
import { type FormEvent, useState } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { pairDevice } from "../api/auth";
import { getHostConfig, isRemoteHost, setHostConfig } from "../api/host";
import { AopLogoMark } from "../components/brand/AopLogoMark";
import { defaultDeviceName } from "./device-name";
import { pairingCodeCommand, pairingHostPort } from "./host-port";

/**
 * Shown when the host answers 401: this browser is not a paired device. The host owner
 * reads a one-time code off the host; trading it here gives this browser a cookie (or, for a
 * host on another origin, a token to send as a bearer header) that authenticates everything after.
 */
export const PairingScreen = ({
  onPaired,
  channel = buildChannel(),
  apiOrigin,
}: {
  onPaired: () => void;
  channel?: ChannelConfig;
  /** Where the host's API is; the page's own origin unless this client names another host. */
  apiOrigin?: string | null;
}) => {
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState(() => defaultDeviceName());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { token } = await pairDevice({ code: code.trim(), name: deviceName.trim() });
      // The cookie the host just set only reaches a host on this origin; another origin needs the token.
      if (isRemoteHost()) setHostConfig({ ...getHostConfig(), token });
      onPaired();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not pair this device");
      setPending(false);
    }
  };

  return (
    <main
      data-testid="pairing-screen"
      className="grid h-screen place-items-center overflow-y-auto bg-canvas px-4"
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="flex w-full max-w-[420px] flex-col gap-5 rounded-modal border border-border bg-surface p-6"
      >
        <div className="flex items-center gap-3">
          <AopLogoMark size={32} />
          <div>
            <h1 className="text-[16px] font-semibold text-text">Pair this device</h1>
            <p className="text-[12.5px] text-text-subtle">
              This computer is not connected to the AOP host yet.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 text-[12.5px] text-text-muted">
          <p>
            On the machine that runs AOP, open Settings, choose Devices and generate a pairing code.
            It works once and expires after ten minutes.
          </p>
          <p className="text-text-subtle">Or ask for one from a terminal on that machine:</p>
          <code
            data-testid="pairing-command"
            className="block rounded-md border border-border bg-input-surface px-2.5 py-2 text-[11.5px] break-all text-text select-all"
          >
            {pairingCodeCommand(pairingHostPort(channel, apiOrigin))}
          </code>
          <p data-testid="pairing-port-hint" className="text-text-subtle">
            Use the port the host listens on; {channel.productName}'s default is {channel.hostPort}.
            See docs/HOST.md.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pairing-code">Pairing code</Label>
          <Input
            id="pairing-code"
            data-testid="pairing-code-input"
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={32}
            placeholder="K7QM-4XNP"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pairing-device-name">Device name</Label>
          <Input
            id="pairing-device-name"
            data-testid="pairing-device-name"
            autoComplete="off"
            maxLength={100}
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
          />
        </div>

        {error ? (
          <p data-testid="pairing-error" role="alert" className="text-[12.5px] text-blocked">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          data-testid="pairing-submit"
          disabled={pending || code.trim() === "" || deviceName.trim() === ""}
        >
          {pending ? "Pairing…" : "Pair this device"}
        </Button>
      </form>
    </main>
  );
};
