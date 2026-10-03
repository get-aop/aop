import { buildChannel, type Device, type PairingCode } from "@aop/common";
import { LaptopIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { renderSVG } from "uqr";
import { Button } from "@/ui/button";
import { createPairingCode } from "../api/auth";
import { requestConfirmation } from "../components/ConfirmationHost";
import { useNow } from "../projects/use-now";
import {
  describeClient,
  describeLastSeen,
  formatCountdown,
  formatPaired,
  secondsLeft,
} from "./devices-format";
import { pairingLink } from "./pairing-link";
import { useDevices } from "./use-devices";

/**
 * The paired devices on AOP settings › Host: each with the app and version it runs, and a pairing
 * code to type into a new one. Whoever may manage the host (the `host_management` setting) pairs
 * and revokes; everyone else sees the list read-only, with the reason.
 */
export const HostDevices = ({
  pollMs,
  canManage,
  currentDeviceId,
  blockedReason,
}: {
  pollMs?: number;
  canManage: boolean;
  /** This viewer's own device, marked "This device"; null on the host machine. */
  currentDeviceId: string | null;
  blockedReason: string | null;
}) => {
  const { devices, error, revoke } = useDevices(pollMs);

  return (
    <div data-testid="section-devices" className="flex flex-col gap-4">
      <DeviceList
        devices={devices}
        error={error}
        revoke={canManage ? revoke : null}
        currentDeviceId={currentDeviceId}
      />
      {canManage ? (
        <PairingPanel devices={devices} />
      ) : (
        <p data-testid="devices-readonly" className="text-[12px] text-waiting">
          {blockedReason}
        </p>
      )}
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
          Open this host's address (above) in the AOP app or a browser on the other computer and
          enter the code with a name for that device. A code works once, and a new code replaces the
          one before it. On the host, <code>{buildChannel().binaryName} pair</code> prints one too.
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
  <div className="flex max-w-xl flex-col gap-3">
    <CodeRow grant={grant} remaining={remaining} />
    {remaining > 0 ? <PairingQr code={grant.code} /> : null}
  </div>
);

/** The same code as a QR code, for the AOP phone app's scanner. */
const PairingQr = ({ code }: { code: string }) => {
  const src = useMemo(() => {
    const link = pairingLink(code, typeof window === "undefined" ? null : window.location.origin);
    const svg = renderSVG(link, { border: 2, whiteColor: "#ffffff", blackColor: "#0d0d0e" });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [code]);
  return (
    <div className="flex items-center gap-4">
      <img
        data-testid="devices-code-qr"
        src={src}
        alt={`QR code for pairing code ${code}`}
        className="size-36 shrink-0 rounded-row bg-white"
      />
      <p className="text-[12.5px] leading-relaxed text-text-subtle">
        On a phone, scan this with the AOP app instead of typing the code.
      </p>
    </div>
  );
};

const CodeRow = ({ grant, remaining }: { grant: Grant; remaining: number }) => (
  <div
    data-testid="devices-code-card"
    data-expired={remaining === 0}
    className="flex items-center gap-4 rounded-row border border-border-strong bg-raised px-4 py-3"
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
  currentDeviceId,
}: {
  devices: Device[] | null;
  error: string | null;
  /** Null when this viewer may not revoke. */
  revoke: ((device: Device) => Promise<void>) | null;
  currentDeviceId: string | null;
}) => {
  const now = useNow(30_000);

  const confirmRevoke = async (device: Device) => {
    if (!revoke) return;
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
              current={device.id === currentDeviceId}
              onRevoke={revoke ? () => void confirmRevoke(device) : null}
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
  current,
  onRevoke,
}: {
  device: Device;
  now: number;
  current: boolean;
  onRevoke: (() => void) | null;
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
        {current ? (
          <span
            data-testid="device-current"
            className="ml-2 text-[11.5px] font-normal text-text-subtle"
          >
            This device
          </span>
        ) : null}
      </p>
      <DeviceClient device={device} />
      <p className="text-[12px] text-text-subtle">
        <span data-testid="device-last-seen">{describeLastSeen(device.lastSeenAt, now)}</span>
        {" · "}
        <span data-testid="device-created" title={device.createdAt}>
          Paired {formatPaired(device.createdAt)}
        </span>
      </p>
    </div>
    {device.outOfDate ? (
      <span
        data-testid="device-out-of-date"
        className="rounded-md border border-waiting/30 bg-waiting/10 px-1.5 py-px text-[11px] font-medium text-waiting"
      >
        Out of date
      </span>
    ) : null}
    {onRevoke && !current ? (
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
    ) : null}
  </li>
);

const DeviceClient = ({ device }: { device: Device }) => {
  const line = describeClient(device, buildChannel().id === "nightly" ? "AOP Nightly" : "AOP");
  return line ? (
    <p data-testid="device-client" className="text-[12px] text-text-subtle">
      {line}
    </p>
  ) : null;
};
