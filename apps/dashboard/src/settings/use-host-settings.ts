import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getSettings, updateSettings } from "../api/client";

export interface HostSettings {
  /** Key to stored value; null until the first load. */
  values: Record<string, string> | null;
  /** Saves one value; the host's refusal is shown and the old value stays. */
  save: (key: string, value: string) => Promise<void>;
}

/** The host's settings for a page that saves each change as it is made. */
export const useHostSettings = (): HostSettings => {
  const [values, setValues] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    getSettings().then(
      (settings) => setValues(Object.fromEntries(settings.map(({ key, value }) => [key, value]))),
      () => toast.error("Failed to load settings"),
    );
  }, []);

  const save = useCallback(async (key: string, value: string) => {
    try {
      await updateSettings([{ key, value }]);
      setValues((current) => ({ ...current, [key]: value }));
      toast.success("Settings saved");
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Save failed");
    }
  }, []);

  return { values, save };
};
