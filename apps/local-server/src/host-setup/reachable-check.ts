import { type ChannelConfig, type SetupCheck, tailscaleServeCommand } from "@aop/common";
import type { ServeLook } from "./probes.ts";

const TITLE = "Reachable from your other devices";

/**
 * "Reachable from your other devices": the addresses `tailscale serve` publishes the host on.
 * The host listens on loopback only, so without one only this computer reaches it. The how-to is
 * docs/HOST.md's command with this host's port. It serves https on 443, except where that is
 * taken: AOP Nightly runs beside stable and leaves 443 to it (install.sh says the same), and a
 * tailnet name whose 443 already serves something else keeps it.
 */
export const reachableCheck = (
  look: ServeLook,
  port: number,
  host: string,
  channel: ChannelConfig,
): SetupCheck => {
  if (look.addresses.length > 0) {
    return {
      id: "reachable",
      state: "ok",
      title: TITLE,
      detail: `${look.addresses.join(", ")} (tailscale serve)`,
      actions: [],
    };
  }
  return {
    id: "reachable",
    state: "warning",
    title: TITLE,
    detail: "Only this computer can reach it.",
    actions: [
      {
        kind: "how-to",
        steps: [
          ...(look.tailscale
            ? []
            : [
                `Install Tailscale on ${host} and on your other devices, signed in to the same tailnet (https://tailscale.com/download).`,
              ]),
          `On ${host}, publish AOP on your tailnet over HTTPS. Then open the https address \`tailscale serve status\` prints, from any of your devices.`,
        ],
        command: tailscaleServeCommand(port, channel.id, look.httpsDefaultTaken),
      },
    ],
  };
};

/**
 * Reads `tailscale serve status --json`: the URLs whose root proxies to this host's port, and
 * whether https 443 is already in use. Background (`--bg`) and foreground serves both count.
 */
export const parseServeStatus = (
  json: unknown,
  port: number,
): Pick<ServeLook, "addresses" | "httpsDefaultTaken"> => {
  const configs = serveConfigs(json);
  const addresses: string[] = [];
  let httpsDefaultTaken = false;
  for (const config of configs) {
    for (const [hostPort, web] of Object.entries(record(config.Web))) {
      const proxy = record(record(record(web).Handlers)["/"]).Proxy;
      const servesUs = typeof proxy === "string" && proxiesToPort(proxy, port);
      if (servesUs) addresses.push(urlOf(hostPort, config));
      else if (hostPort.endsWith(":443")) httpsDefaultTaken = true;
    }
  }
  return { addresses: [...new Set(addresses)].sort(httpsFirst), httpsDefaultTaken };
};

type ServeConfig = { Web?: unknown; TCP?: unknown };

const serveConfigs = (json: unknown): ServeConfig[] => {
  const root = record(json);
  const foreground = Object.values(record(root.Foreground)).map(record);
  return [root, ...foreground];
};

const LOOPBACK_PROXY = /^(?:[a-z+]+:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):(\d+)\/?$/i;

const proxiesToPort = (proxy: string, port: number): boolean =>
  LOOPBACK_PROXY.exec(proxy.trim())?.[1] === String(port);

const urlOf = (hostPort: string, config: ServeConfig): string => {
  const servePort = hostPort.slice(hostPort.lastIndexOf(":") + 1);
  const https = record(record(config.TCP)[servePort]).HTTPS === true;
  const name = hostPort.slice(0, hostPort.lastIndexOf(":"));
  const defaultPort = https ? "443" : "80";
  return `${https ? "https" : "http"}://${name}${servePort === defaultPort ? "" : `:${servePort}`}`;
};

const httpsFirst = (a: string, b: string): number =>
  Number(b.startsWith("https:")) - Number(a.startsWith("https:")) || a.localeCompare(b);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
