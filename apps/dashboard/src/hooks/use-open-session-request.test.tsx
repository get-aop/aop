import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import {
  consumeOpenSessionRequest,
  peekOpenSessionRequest,
  requestOpenSession,
  resetOpenSessionRequestStore,
  useOpenSessionRequest,
} from "./use-open-session-request";

setupDashboardDom();

const { cleanup, render } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
  resetOpenSessionRequestStore();
});

const Probe = ({ onOpen }: { onOpen: (sessionId: string) => void }) => {
  useOpenSessionRequest(onOpen);
  return null;
};

describe("useOpenSessionRequest", () => {
  test("delivers a pending request once and clears it globally", () => {
    const opens: string[] = [];
    requestOpenSession("session-b");
    expect(peekOpenSessionRequest()?.sessionId).toBe("session-b");

    render(<Probe onOpen={(id) => opens.push(id)} />);
    expect(opens).toEqual(["session-b"]);
    expect(peekOpenSessionRequest()).toBeNull();
    expect(consumeOpenSessionRequest()).toBeNull();
  });

  test("does not replay a consumed request after unmount and remount", () => {
    const opens: string[] = [];
    requestOpenSession("session-b");

    const first = render(<Probe onOpen={(id) => opens.push(id)} />);
    expect(opens).toEqual(["session-b"]);
    first.unmount();

    render(<Probe onOpen={(id) => opens.push(id)} />);
    expect(opens).toEqual(["session-b"]);
  });

  test("delivers a newer request after the previous one was consumed", () => {
    const opens: string[] = [];
    requestOpenSession("session-b");
    const first = render(<Probe onOpen={(id) => opens.push(id)} />);
    expect(opens).toEqual(["session-b"]);
    first.unmount();

    requestOpenSession("session-c");
    render(<Probe onOpen={(id) => opens.push(id)} />);
    expect(opens).toEqual(["session-b", "session-c"]);
    expect(peekOpenSessionRequest()).toBeNull();
  });
});
