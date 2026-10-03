import { expect } from "bun:test";
import type { AppUpdateState } from "@aop/common";
import { App } from "../App";
import type { DesktopState } from "../backend/types";
import { createFakeBackend, makeState } from "./fake-backend";

export const HOST = "https://mac.tail1234.ts.net";

/**
 * Renders the app's screens against a fake backend and waits for the first one. Call
 * `setupDesktopDom()` first in the test file: Testing Library is loaded here, after the DOM is.
 */
export const showApp = async (state: DesktopState = makeState(), update?: AppUpdateState) => {
  const { render, waitFor } = await import("@testing-library/react");
  const fake = createFakeBackend(state, update);
  const view = render(<App backend={fake.backend} />);
  await waitFor(() => expect(view.container.querySelector("main")).not.toBeNull());
  return { ...fake, view };
};

export type ShownApp = Awaited<ReturnType<typeof showApp>>;

export const typeInto = async (view: ShownApp["view"], testId: string, value: string) => {
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.change(view.getByTestId(testId), { target: { value } });
};

/** A remote host's state, connected or otherwise. */
export const remote = (connection: DesktopState["connection"]) =>
  makeState({ mode: "remote", remoteUrl: HOST, connection });
