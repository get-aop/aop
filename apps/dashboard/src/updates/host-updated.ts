import { useEffect } from "react";
import { toast } from "sonner";
import { openExternalUrl } from "../api/settings";

const KEY = "aop:host-updated:v1";
const EVENT = "aop:host-updated";

export interface HostUpdated {
  version: string;
  hostName: string;
  releaseUrl: string | null;
}

/**
 * Notes that the host came back on a new release. A browser reloads right after (its dashboard
 * came from the old host), so the note waits in session storage for the reloaded page; showing
 * it now would use it up before the reload. The desktop app does not reload and says it at once.
 */
export const rememberHostUpdated = (
  updated: HostUpdated,
  { reloading }: { reloading: boolean },
): void => {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // Without storage the toast is skipped; the version in the switcher still says it.
  }
  if (!reloading) window.dispatchEvent(new Event(EVENT));
};

/** Shows "Host soulf updated to x · Release notes" once, after the host came back on x. */
export const useHostUpdatedToast = (): void => {
  useEffect(() => {
    const show = () => {
      const updated = takeHostUpdated();
      if (!updated) return;
      const host = updated.hostName ? `Host ${updated.hostName}` : "The host";
      const { releaseUrl } = updated;
      // Long enough to be seen after the reload, which lands while the person looks elsewhere.
      toast.success(`${host} updated to ${updated.version}`, {
        duration: 15_000,
        action: releaseUrl
          ? { label: "Release notes", onClick: () => openExternalUrl(releaseUrl) }
          : undefined,
      });
    };
    show();
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, []);
};

const takeHostUpdated = (): HostUpdated | null => {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as HostUpdated;
  } catch {
    return null;
  }
};
