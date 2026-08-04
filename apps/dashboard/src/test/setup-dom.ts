import { Window } from "happy-dom";

const copyWindowProperties = (win: Window) => {
  for (const key of Object.getOwnPropertyNames(win)) {
    if (!(key in globalThis)) {
      Object.defineProperty(globalThis, key, {
        value: (win as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
  }
};

/**
 * Bun ships native event globals, so copyWindowProperties skips them — but
 * Radix constructs events from the global constructors and happy-dom's
 * dispatchEvent rejects cross-realm events. Force the happy-dom versions.
 */
const EVENT_GLOBALS = [
  "Event",
  "CustomEvent",
  "MouseEvent",
  "PointerEvent",
  "KeyboardEvent",
  "FocusEvent",
  "InputEvent",
  "EventTarget",
] as const;

const forceCopyEventGlobals = (win: Window) => {
  for (const key of EVENT_GLOBALS) {
    const value = (win as unknown as Record<string, unknown>)[key];
    if (typeof value !== "undefined") {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
  }
};

const installResizeObserverForTests = (): void => {
  globalThis.ResizeObserver = class ResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element): void {
      queueMicrotask(() => {
        const rect = target.getBoundingClientRect();
        const width = rect.width > 0 ? rect.width : 800;
        const height = rect.height > 0 ? rect.height : 600;
        this.callback(
          [
            {
              target,
              contentRect: {
                width,
                height,
                top: 0,
                left: 0,
                right: width,
                bottom: height,
                x: 0,
                y: 0,
              } as DOMRectReadOnly,
            } as ResizeObserverEntry,
          ],
          this,
        );
      });
    }

    unobserve(): void {}

    disconnect(): void {}
  };
};

const installDialogElementPolyfill = (): void => {
  const proto = getDialogElementPrototype();
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.removeAttribute("open");
    };
  }
};

const getDialogElementPrototype = (): HTMLDialogElement => {
  const win = globalThis.document?.defaultView as
    | (Window & { HTMLDialogElement?: typeof HTMLDialogElement })
    | null;
  const dialog = globalThis.document.createElement("dialog");
  const dialogConstructor =
    globalThis.HTMLDialogElement ?? win?.HTMLDialogElement ?? dialog.constructor;

  if (typeof globalThis.HTMLDialogElement === "undefined") {
    Object.defineProperty(globalThis, "HTMLDialogElement", {
      value: dialogConstructor,
      configurable: true,
      writable: true,
    });
  }

  return dialogConstructor.prototype as HTMLDialogElement;
};

const installWindowGlobals = (win: Window): void => {
  Object.defineProperty(globalThis, "window", {
    value: win,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: win.localStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: win.sessionStorage,
    configurable: true,
    writable: true,
  });
};

export const setupDashboardDom = () => {
  if (!globalThis.document || !("defaultView" in globalThis.document)) {
    const win = new Window({ url: "http://localhost" });
    copyWindowProperties(win);
    globalThis.document = win.document as unknown as Document;
  }

  const activeWindow = globalThis.document.defaultView as unknown as Window;
  copyWindowProperties(activeWindow);
  forceCopyEventGlobals(activeWindow);
  installWindowGlobals(activeWindow);
  installDialogElementPolyfill();
  installResizeObserverForTests();

  // Base UI scroll-area uses Element.getAnimations — happy-dom does not
  // implement it. Return an empty list so components render without motion.
  if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
    Object.defineProperty(Element.prototype, "getAnimations", {
      value: function getAnimations() {
        return [];
      },
      configurable: true,
      writable: true,
    });
  }

  const win = globalThis.document.defaultView as
    | (Window & { SyntaxError?: typeof SyntaxError })
    | null;
  if (win && win.SyntaxError === undefined) {
    Object.defineProperty(win, "SyntaxError", {
      value: SyntaxError,
      configurable: true,
      writable: true,
    });
  }
};
