import { useEffect, useState } from "react";
import { getPrincipal } from "../api/auth";

/**
 * Whether the host says this client is its owner: a request made on the host machine itself.
 * Only the owner may pair and revoke devices, so only the owner is shown those screens. It asks
 * again each time `enabled` turns on, and answers false until the host has said otherwise.
 */
export const useIsHostOwner = (enabled: boolean): boolean => {
  const [owner, setOwner] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    getPrincipal().then(
      (principal) => current && setOwner(principal.kind === "owner"),
      () => current && setOwner(false),
    );
    return () => {
      current = false;
    };
  }, [enabled]);

  return owner;
};
