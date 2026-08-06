/**
 * Browser harness for the live-streaming reveal. NOT part of the app: mounts
 * the real useStreamingReveal + ChatMarkdown (same structure as RunActivityBody)
 * and replays a real PI/DeepSeek SSE event stream under a virtual clock.
 *
 * The event handling replicates the dashboard's sessions-page-helpers-stream
 * applyAssistantProgress logic exactly (delta accumulation + replace frames).
 *
 * Driver contract:
 * - window.__HARNESS_BOOT({ events, virtualMsPerFrame, sampleEveryMs }) boots
 *   the replay. `events` = [{ type, data }] with a `t` (virtual ms) per event.
 * - window.__HARNESS_RESULT() returns { samples, blinks } after completion.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "./views/sessions/ChatMarkdown";
import { useStreamingReveal } from "./views/sessions/use-streaming-reveal";

declare global {
  interface Window {
    __HARNESS_BOOT: (config: {
      events: Array<{ t: number; type: string; data: Record<string, unknown> }>;
      virtualMsPerFrame: number;
      sampleEveryMs: number;
    }) => void;
    __HARNESS_RESULT: () => unknown;
    __HARNESS_READY: boolean;
  }
}

type Sample = {
  t: number;
  targetThinking: number;
  targetContent: number;
  visibleThinking: number;
  visibleContent: number;
  thinkingParagraphs: number;
  contentParagraphs: number;
};

type BlinkEvent = { t: number; kind: string; before: number; after: number };

const result: { samples: Sample[]; blinks: BlinkEvent[] } = { samples: [], blinks: [] };

/* ------------------------------------------------------------------ */
/* Virtual clock: 1 real frame advances `virtualMsPerFrame` virtual ms */
/* ------------------------------------------------------------------ */
let virtualMs = 0;
let virtualMsPerFrame = 300;
const frameQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextFrameId = 1;
let pumpTimer: ReturnType<typeof setInterval> | null = null;

const originalRaf = globalThis.requestAnimationFrame.bind(globalThis);
const originalCaf = globalThis.cancelAnimationFrame.bind(globalThis);
const originalNow = performance.now.bind(performance);

export const installVirtualClock = (msPerFrame: number): void => {
  virtualMsPerFrame = msPerFrame;
  virtualMs = 0;
  frameQueue.length = 0;
  nextFrameId = 1;
  performance.now = () => virtualMs;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frameQueue.push({ id, cb });
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    const index = frameQueue.findIndex((frame) => frame.id === id);
    if (index >= 0) frameQueue.splice(index, 1);
  }) as typeof cancelAnimationFrame;
  if (pumpTimer) clearInterval(pumpTimer);
  pumpTimer = setInterval(() => {
    virtualMs += virtualMsPerFrame;
    const frames = frameQueue.splice(0, frameQueue.length);
    for (const frame of frames) frame.cb(virtualMs);
  }, 16.67);
};

export const restoreRealClock = (): void => {
  if (pumpTimer) clearInterval(pumpTimer);
  pumpTimer = null;
  performance.now = originalNow;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCaf;
};

/* ------------------------------------------------------------------ */

type StreamProgress = {
  thinking: string;
  content: string;
  commandGroups: unknown[];
};

const LiveRow = ({
  thinking,
  content,
  active,
}: {
  thinking: string;
  content: string;
  active: boolean;
}) => {
  const visibleThinking = useStreamingReveal(thinking, active);
  const visibleContent = useStreamingReveal(content, active);
  return (
    <div className="reveal-harness-row">
      {visibleThinking ? (
        <div data-testid="assistant-thinking" className="text-foreground/82">
          {active ? (
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
              {visibleThinking}
            </div>
          ) : (
            <ChatMarkdown content={visibleThinking} />
          )}
        </div>
      ) : null}
      {visibleContent ? (
        <div data-testid="assistant-stream-content" className="t3-chat-message">
          {active ? (
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
              {visibleContent}
            </div>
          ) : (
            <ChatMarkdown content={visibleContent} />
          )}
        </div>
      ) : null}
    </div>
  );
};

const HarnessApp = ({ config }: { config: Parameters<typeof window.__HARNESS_BOOT>[0] }) => {
  const [progress, setProgress] = useState<StreamProgress | null>(null);
  const [typing, setTyping] = useState(false);
  const progressRef = useRef<StreamProgress | null>(null);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    const samples = result.samples;
    const blinks = result.blinks;
    let cancelled = false;
    let cursor = 0;
    const sampleEveryMs = config.sampleEveryMs ?? 250;
    let lastSampleT = -1;
    let lastVisibleT = 0;
    let lastVisibleC = 0;
    let lastTText = "";
    let lastCText = "";

    // Exact copy of applyAssistantProgress from sessions-page-helpers-stream.ts
    const applyAssistantProgress = (payload: Record<string, unknown>) => {
      setTyping(true);
      const thinking = typeof payload.thinking === "string" ? payload.thinking : "";
      const content = typeof payload.content === "string" ? payload.content : "";
      const commandGroups = Array.isArray(payload.commandGroups) ? payload.commandGroups : [];
      const replace = payload.replace === true;
      setProgress((current) => {
        if (replace) {
          return { thinking, content, commandGroups };
        }
        return {
          thinking: (current?.thinking ?? "") + thinking,
          content: (current?.content ?? "") + content,
          commandGroups,
        };
      });
    };

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: harness blink/paragraph sampler
    const sample = (t: number) => {
      const thinkingEl = document.querySelector('[data-testid="assistant-thinking"]');
      const contentEl = document.querySelector('[data-testid="assistant-stream-content"]');
      const visibleT = thinkingEl?.textContent?.length ?? 0;
      const visibleC = contentEl?.textContent?.length ?? 0;
      if (visibleT < lastVisibleT) {
        blinks.push({ t, kind: "thinking-shrink", before: lastVisibleT, after: visibleT });
      } else if (
        visibleT > 0 &&
        lastTText &&
        !(thinkingEl?.textContent ?? "").startsWith(lastTText)
      ) {
        blinks.push({ t, kind: "thinking-replace", before: lastVisibleT, after: visibleT });
      }
      if (visibleC < lastVisibleC) {
        blinks.push({ t, kind: "content-shrink", before: lastVisibleC, after: visibleC });
      } else if (
        visibleC > 0 &&
        lastCText &&
        !(contentEl?.textContent ?? "").startsWith(lastCText)
      ) {
        blinks.push({ t, kind: "content-replace", before: lastVisibleC, after: visibleC });
      }
      lastVisibleT = visibleT;
      lastVisibleC = visibleC;
      lastTText = thinkingEl?.textContent ?? "";
      lastCText = contentEl?.textContent ?? "";
      const countParagraphs = (root: Element | null) => root?.querySelectorAll("p").length ?? 0;
      samples.push({
        t,
        targetThinking: progressRef.current?.thinking.length ?? 0,
        targetContent: progressRef.current?.content.length ?? 0,
        visibleThinking: visibleT,
        visibleContent: visibleC,
        thinkingParagraphs: countParagraphs(thinkingEl),
        contentParagraphs: countParagraphs(contentEl),
      });
    };

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: harness replay loop
    const frame = () => {
      if (cancelled) return;
      const now = performance.now();
      while (cursor < config.events.length) {
        const event = config.events[cursor]!;
        if (event.t > now) break;
        if (event.type === "assistant-typing") {
          setTyping(true);
          setProgress({ thinking: "", content: "", commandGroups: [] });
        } else if (event.type === "assistant-progress") {
          applyAssistantProgress(event.data);
        } else if (event.type === "assistant-final") {
          setTyping(false);
          setProgress(null);
        }
        cursor += 1;
      }
      if (now - lastSampleT >= sampleEveryMs) {
        lastSampleT = now;
        sample(now);
      }
      setProgress((current) => current ?? null); // no-op to keep ref fresh
      const endT = config.events[config.events.length - 1]?.t ?? 0;
      const target = progressRef.current;
      const revealed =
        target === null ||
        (lastVisibleT >= target.thinking.length && lastVisibleC >= target.content.length);
      if (cursor < config.events.length || (!revealed && now < endT + 400_000)) {
        requestAnimationFrame(frame);
      } else {
        setTyping(false);
        sample(now);
      }
    };
    requestAnimationFrame(frame);
    return () => {
      cancelled = true;
    };
  }, [config]);

  const state = progress ?? { thinking: "", content: "", commandGroups: [] };
  return (
    <div className="reveal-harness" data-typing={typing ? "true" : "false"}>
      <LiveRow thinking={state.thinking} content={state.content} active={typing} />
    </div>
  );
};

const boot = (config: Parameters<typeof window.__HARNESS_BOOT>[0]) => {
  result.samples = [];
  result.blinks = [];
  installVirtualClock(config.virtualMsPerFrame ?? 300);
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");
  createRoot(root).render(<HarnessApp config={config} />);
};

window.__HARNESS_BOOT = boot;
window.__HARNESS_RESULT = () => result;
window.__HARNESS_READY = true;
