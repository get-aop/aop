import { afterEach, beforeEach } from "bun:test";
import { Window } from "happy-dom";

const GLOBAL_KEYS = [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "navigator",
  "localStorage",
  "sessionStorage",
] as const;

type GlobalKey = (typeof GLOBAL_KEYS)[number];

export const setupDesktopDom = (): void => {
  installFallbackDom();

  let window: Window;
  let previousGlobals: Partial<Record<GlobalKey, unknown>>;

  beforeEach(() => {
    previousGlobals = Object.fromEntries(
      GLOBAL_KEYS.map((key) => [key, globalThis[key as keyof typeof globalThis]]),
    ) as Partial<Record<GlobalKey, unknown>>;
    window = new Window({ url: "http://tauri.localhost" });
    installGlobal("window", window);
    installGlobal("document", window.document);
    installGlobal("HTMLElement", window.HTMLElement);
    installGlobal("HTMLButtonElement", window.HTMLButtonElement);
    installGlobal("navigator", window.navigator);
    installGlobal("localStorage", window.localStorage);
    installGlobal("sessionStorage", window.sessionStorage);
  });

  afterEach(() => {
    window.happyDOM.abort();
    restoreGlobals(previousGlobals);
    installFallbackDom();
  });
};

const installGlobal = (key: GlobalKey, value: unknown): void => {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
};

const restoreGlobals = (previousGlobals: Partial<Record<GlobalKey, unknown>>): void => {
  for (const key of GLOBAL_KEYS) {
    if (previousGlobals[key] === undefined) {
      Reflect.deleteProperty(globalThis, key);
      continue;
    }

    installGlobal(key, previousGlobals[key]);
  }
};

const installFallbackDom = (): void => {
  if (globalThis.document?.body) return;

  const window = new Window({ url: "http://localhost" });
  installGlobal("window", window);
  installGlobal("document", window.document);
  installGlobal("HTMLElement", window.HTMLElement);
  installGlobal("HTMLButtonElement", window.HTMLButtonElement);
  installGlobal("navigator", window.navigator);
  installGlobal("localStorage", window.localStorage);
  installGlobal("sessionStorage", window.sessionStorage);
};
