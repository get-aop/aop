import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import type { DesktopBackend, DesktopState } from "./backend/types";
import { chooseScreen, parseScreenHash, type Screen } from "./screen-choice";
import { ConnectScreen } from "./screens/ConnectScreen";
import { HostModeScreen } from "./screens/HostModeScreen";
import { StatusScreen } from "./screens/StatusScreen";

interface AppProps {
  backend: DesktopBackend;
}

/**
 * The app's own pages, shown while there is no dashboard to show: first run, "Change host", the
 * host on this Mac, and a host that cannot be reached. Once connected the window moves on to
 * the bundled dashboard, and the app brings this page back when the host needs the person.
 */
export const App = ({ backend }: AppProps): ReactElement | null => {
  const state = useDesktopState(backend);
  const [requested, setRequested] = useState<Screen | null>(() =>
    parseScreenHash(window.location.hash),
  );

  useEffect(() => {
    const onHashChange = () => setRequested(parseScreenHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const show = useCallback((screen: Screen | null) => {
    window.location.hash = screen ? `#/${screen}` : "";
  }, []);

  if (!state) return null;
  const screen = chooseScreen(state, requested);
  const hasHostToGoBackTo = state.mode !== null;

  switch (screen) {
    case "connect":
      return (
        <ConnectScreen
          state={state}
          backend={backend}
          onBack={hasHostToGoBackTo ? () => show(null) : null}
          onManageLocalHost={() => void backend.startHostMode()}
        />
      );
    case "host":
      return (
        <HostModeScreen state={state} backend={backend} onChangeHost={() => show("connect")} />
      );
    case "status":
      return <StatusScreen state={state} backend={backend} onChangeHost={() => show("connect")} />;
  }
};

/** The app's state, read once and then kept current by what the app pushes. */
const useDesktopState = (backend: DesktopBackend): DesktopState | null => {
  const [state, setState] = useState<DesktopState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stop = backend.onStateChanged((next) => {
      if (!cancelled) setState(next);
    });
    void backend.getState().then((initial) => {
      if (!cancelled) setState((current) => current ?? initial);
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [backend]);

  return state;
};
