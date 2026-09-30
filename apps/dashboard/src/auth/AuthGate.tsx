import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button } from "@/ui/button";
import { getPrincipal } from "../api/auth";
import { isUnauthenticated, onUnauthenticated } from "../api/request";
import { AopLogoMark } from "../components/brand/AopLogoMark";
import { PairingScreen } from "./PairingScreen";

type AuthState =
  | { status: "checking" }
  | { status: "authenticated" }
  | { status: "unpaired" }
  | { status: "unreachable"; message: string };

/**
 * Lets the app through only once the host knows who this client is. The host owner's own
 * dashboard is known at once; any other browser must pair first. A request that later answers
 * 401 (a revoked device) brings the pairing screen back.
 */
export const AuthGate = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<AuthState>({ status: "checking" });

  const check = useCallback(async () => {
    setState({ status: "checking" });
    try {
      await getPrincipal();
      setState({ status: "authenticated" });
    } catch (error) {
      setState(
        isUnauthenticated(error)
          ? { status: "unpaired" }
          : {
              status: "unreachable",
              message: error instanceof Error ? error.message : "The host did not answer",
            },
      );
    }
  }, []);

  useEffect(() => {
    void check();
    return onUnauthenticated(() => setState({ status: "unpaired" }));
  }, [check]);

  switch (state.status) {
    case "authenticated":
      return children;
    case "unpaired":
      return <PairingScreen onPaired={() => void check()} />;
    case "unreachable":
      return <HostUnreachable message={state.message} onRetry={() => void check()} />;
    case "checking":
      return (
        <main
          data-testid="auth-checking"
          className="grid h-screen place-items-center bg-canvas text-[13px] text-text-subtle"
        >
          <AopLogoMark size={32} animated />
        </main>
      );
  }
};

const HostUnreachable = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <main
    data-testid="host-unreachable"
    className="grid h-screen place-items-center bg-canvas px-4 text-center"
  >
    <div className="flex max-w-sm flex-col items-center gap-3">
      <AopLogoMark size={32} />
      <h1 className="text-[15px] font-semibold text-text">Cannot reach the AOP host</h1>
      <p className="text-[13px] text-text-subtle">{message}</p>
      <Button variant="secondary" size="sm" data-testid="host-retry" onClick={onRetry}>
        Try again
      </Button>
    </div>
  </main>
);
