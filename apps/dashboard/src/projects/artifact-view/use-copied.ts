import { useEffect, useRef, useState } from "react";

/** Copies text and says so for a moment: `[copied, copy]`. */
export const useCopied = (ms = 1_500): [boolean, (text: string) => Promise<void>] => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), ms);
    } catch {
      setCopied(false);
    }
  };
  return [copied, copy];
};
