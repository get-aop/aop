import type { ReactNode } from "react";
import { openExternalUrl } from "../api/settings";

/** A link that opens outside the app: a release's notes, a CLI's changelog. */
export const ReleaseNotesLink = ({
  url,
  testId = "update-release-notes-link",
  className = "text-running hover:underline",
  children = "Release notes",
}: {
  url: string;
  testId?: string;
  className?: string;
  children?: ReactNode;
}) => (
  <a
    data-testid={testId}
    href={url}
    target="_blank"
    rel="noreferrer"
    onClick={(event) => {
      event.preventDefault();
      openExternalUrl(url);
    }}
    className={className}
  >
    {children}
  </a>
);
