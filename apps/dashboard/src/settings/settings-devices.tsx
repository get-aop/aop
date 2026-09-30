import type { Device, PairingCode } from "@aop/common";
import { LaptopIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { createPairingCode } from "../api/auth";
import { requestConfirmation } from "../components/ConfirmationHost";
import { useNow } from "../projects/use-now";
import { describeLastSeen, formatCountdown, formatPaired, secondsLeft } from "./devices-format";
import { useDevices } from "./use-devices";

/**
 * Settings §Devices, for the host owner: a pairing code to type into a new device, and the
 * devices already paired, each of which can be revoked.
 */
export const SettingsDevices = ({ pollMs }: { pollMs?: number }) => {
  const { devices, error, revoke } = useDevices(pollMs);

  return (
    <div data-testid="section-devices" className="flex flex-col gap-6 p-4">
      <PairingPanel devices={devices} />
      <DeviceList devices={devices} error={error} revoke={revoke} />
    </div>
  );
};

/** A code the host issued, and the devices it knew when it did: a device beyond those used it. */
interface Grant extends PairingCode {
  knownDeviceIds: readonly string[];
}

const PairingPanel = ({ devices }: { devices: Device[] | null }) => {
  const [grant, setGrant] = useState<Grant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const issued = await createPairingCode();
      setGrant({ ...issued, knownDeviceIds: (devices ?? []).map((device) => device.id) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a pairing code");
    } finally {
      setBusy(false);
    }
  };

  const pairedWithIt = grant ? devices?.find((d) => !grant.knownDeviceIds.includes(d.id)) : null;
  const remaining = grant ? secondsLeft(grant.expiresAt, now) : 0;

  return (
    <section data-testid="devices-pairing" className="flex flex-col gap-3">
      <div>
        <h2 className="text-[13px] font-semibold text-text">Pair a device</h2>
        <p className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-text-subtle">
          Open this host's address in the browser or app on the other computer and enter the code
          with a name for that device. A code works once, and a new code replaces the one before it.
        </p>
      </div>
      {grant && !pairedWithIt ? <CodeCard grant={grant} remaining={remaining} /> : null}
      {pairedWithIt ? (
        <p role="status" data-testid="devices-paired-notice" className="text-[12.5px] text-ok">
          {pairedWithIt.name} is paired.
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="devices-error" className="text-[12.5px] text-blocked">
          {error}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid="devices-generate"
          disabled={busy || devices === null}
          onClick={() => void generate()}
        >
          {grant && !pairedWithIt ? "Generate a new code" : "Generate pairing code"}
        </Button>
      </div>
    </section>
  );
};

const CodeCard = ({ grant, remaining }: { grant: Grant; remaining: number }) => (
  <div
    data-testid="devices-code-card"
    data-expired={remaining === 0}
    className="flex max-w-xl items-center gap-4 rounded-row border border-border-strong bg-raised px-4 py-3"
  >
    <span
      data-testid="devices-code"
      data-expires-at={grant.expiresAt}
      className={
        remaining === 0
          ? "text-[22px] font-semibold tracking-[0.14em] text-text-subtle line-through"
          : "select-all text-[22px] font-semibold tracking-[0.14em] text-text"
      }
    >
      {grant.code}
    </span>
    <span data-testid="devices-code-countdown" className="ml-auto text-[12.5px] text-text-muted">
      {remaining === 0 ? "Expired" : `Expires in ${formatCountdown(remaining)}`}
    </span>
  </div>
);

const DeviceList = ({
  devices,
  error,
  revoke,
}: {
  devices: Device[] | null;
  error: string | null;
  revoke: (device: Device) => Promise<void>;
}) => {
  const now = useNow(30_000);

  const confirmRevoke = async (device: Device) => {
    const confirmed = await requestConfirmation({
      title: `Revoke “${device.name}”?`,
      message:
        "It is signed out at once and its open connections close. To use this host again it must be paired with a new code.",
      confirmLabel: "Revoke device",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await revoke(device);
      toast.success(`${device.name} revoked`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not revoke the device");
    }
  };

  return (
    <section data-testid="devices-list-section" className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-text">Paired devices</h2>
      {error ? (
        <p role="alert" data-testid="devices-list-error" className="text-[12.5px] text-blocked">
          {error}
        </p>
      ) : null}
      {devices === null ? (
        <p className="py-4 text-[12.5px] text-text-subtle">Loading devices…</p>
      ) : devices.length === 0 ? (
        <p data-testid="devices-empty" className="py-2 text-[12.5px] text-text-subtle">
          No device is paired yet. Only this computer can use the host until you pair one.
        </p>
      ) : (
        <ul data-testid="devices-list" className="flex flex-col gap-1.5">
          {devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              now={now}
              onRevoke={() => void confirmRevoke(device)}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

const DeviceRow = ({
  device,
  now,
  onRevoke,
}: {
  device: Device;
  now: number;
  onRevoke: () => void;
}) => (
  <li
    data-testid="device-row"
    data-device-id={device.id}
    className="flex items-center gap-3 rounded-row border border-border bg-raised px-3 py-2.5"
  >
    <LaptopIcon className="size-4 shrink-0 text-text-subtle" strokeWidth={1.7} />
    <div className="min-w-0 flex-1">
      <p data-testid="device-name" className="truncate text-[13px] font-medium text-text">
        {device.name}
      </p>
      <p className="text-[12px] text-text-subtle">
        <span data-testid="device-last-seen">{describeLastSeen(device.lastSeenAt, now)}</span>
        {" · "}
        <span data-testid="device-created" title={device.createdAt}>
          Paired {formatPaired(device.createdAt)}
        </span>
      </p>
    </div>
    <Button
      type="button"
      variant="secondary"
      size="xs"
      data-testid="device-revoke"
      aria-label={`Revoke ${device.name}`}
      onClick={onRevoke}
    >
      Revoke
    </Button>
  </li>
);
