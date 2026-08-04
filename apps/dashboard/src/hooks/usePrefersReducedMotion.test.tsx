import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { act, cleanup, render } = await import("@testing-library/react");
const { usePrefersReducedMotion } = await import("./usePrefersReducedMotion");
const originalMatchMedia = window.matchMedia.bind(window);

type Listener = (event: { matches: boolean }) => void;

const installMatchMedia = (initialMatches: boolean) => {
  const listeners = new Set<Listener>();
  let matches = initialMatches;
  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  };
  (window as unknown as { matchMedia: (q: string) => unknown }).matchMedia = () => mediaQueryList;
  return {
    emit: (next: boolean) => {
      matches = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
};

const Probe = () => {
  const reduced = usePrefersReducedMotion();
  return <span data-testid="value">{reduced ? "reduced" : "full"}</span>;
};

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

describe("usePrefersReducedMotion", () => {
  test("reflects the initial matchMedia state", () => {
    installMatchMedia(true);
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("value").textContent).toBe("reduced");
  });

  test("updates when the preference changes", () => {
    const media = installMatchMedia(false);
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("value").textContent).toBe("full");

    act(() => media.emit(true));
    expect(getByTestId("value").textContent).toBe("reduced");
  });
});
