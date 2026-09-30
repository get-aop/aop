import { normalizeReleaseVersion } from "@aop/common";
import { useEffect, useState } from "react";
import { getHostVersion } from "../api/client";

/** How the person reads the host's release: `v0.2.1`, or `dev build` when the host has no build version. */
export const formatHostVersion = (version: string): string =>
  version === "dev" ? "dev build" : `v${normalizeReleaseVersion(version)}`;

/**
 * The host's release for showing, or null until the host has answered. It is read once: a host
 * does not change version while a page is open, and a restart on a new release reloads the page.
 */
export const useHostVersion = (): string | null => {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    getHostVersion()
      .then((reported) => {
        if (current) setVersion(formatHostVersion(reported));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  return version;
};
