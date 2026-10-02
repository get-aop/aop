import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * A GitHub account's avatar, round, at `size` pixels. An account with no avatar, or one that
 * fails to load (offline, blocked), shows its initial instead.
 */
export const GithubAvatar = ({
  login,
  avatarUrl,
  size = 16,
  className,
}: {
  login: string;
  avatarUrl: string | null;
  size?: number;
  className?: string;
}) => {
  // Remembers which address failed, so a new picture for the same spot gets its own try.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = { width: size, height: size };
  if (!avatarUrl || failedUrl === avatarUrl) {
    return (
      <span
        aria-hidden="true"
        style={{ ...style, fontSize: Math.max(8, Math.round(size * 0.55)) }}
        className={cn(
          "inline-grid shrink-0 place-items-center rounded-full bg-active font-semibold text-text-muted uppercase",
          className,
        )}
      >
        {login.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={withSize(avatarUrl, size)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(avatarUrl)}
      style={style}
      className={cn("shrink-0 rounded-full bg-active", className)}
    />
  );
};

// GitHub serves an avatar at the size asked for; twice the drawn size stays sharp on a retina screen.
const withSize = (url: string, size: number): string => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("githubusercontent.com")) {
      parsed.searchParams.set("s", String(size * 2));
    }
    return parsed.toString();
  } catch {
    return url;
  }
};
