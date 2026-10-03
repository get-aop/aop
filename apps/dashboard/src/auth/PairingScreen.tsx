import { buildChannel, type ChannelConfig } from "@aop/common";
import { type FormEvent, useState } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { pairDevice } from "../api/auth";
import { getHostConfig, isRemoteHost, setHostConfig } from "../api/host";
import { AopLogoMark } from "../components/brand/AopLogoMark";
import { defaultDeviceName } from "./device-name";

/**
 * Shown in a browser when the host answers 401: this browser is not a paired device. A code
 * made on the host, or on any device already paired, trades here for a cookie (or, for a host
 * on another origin, a token to send as a bearer header) that authenticates everything after.
 * The desktop app never shows it: it pairs on its own connect screen (see AuthGate).
 */
export const PairingScreen = ({
  onPaired,
  channel = buildChannel(),
}: {
  onPaired: () => void;
  channel?: ChannelConfig;
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
              This browser is not connected to the AOP host yet.
            </p>
          </div>
        </div>

        <p data-testid="pairing-help" className="text-[12.5px] text-text-muted">
          Get a code on the host: AOP settings › Host › Pair a device, or run{" "}
          <code className="rounded border border-border bg-input-surface px-1 text-[11.5px] text-text">
            {channel.binaryName} pair
          </code>{" "}
          there. Any device already paired can also make one. A code works once and expires after
          ten minutes.
        </p>

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
