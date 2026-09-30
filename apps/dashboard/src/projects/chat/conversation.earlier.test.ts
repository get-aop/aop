import { describe, expect, test } from "bun:test";
import type { MessagePage } from "@aop/common";
import { type Conversation, createConversation } from "./conversation";
import { createFakeEvents, deferred, ids, page, reply } from "./test-utils";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const THREAD = "thr_1";
const inThread = (id: string, seconds: number) =>
  reply(id, seconds, undefined, { threadId: THREAD });
const held = (conversation: Conversation) => ids(conversation.getState().messages);

describe("loading earlier messages", () => {
  const pagedSetup = (answer: (before: string | undefined) => Promise<MessagePage>) => {
    const fake = createFakeEvents();
    const asked: (string | undefined)[] = [];
    const conversation = createConversation({
      projectId: "prj_1",
      scope: THREAD,
      listMessages: (before) => {
        asked.push(before);
        return answer(before);
      },
      events: fake.events,
      schedule: () => () => {},
    });
    return { conversation, fake, asked };
  };

  const newest = page([inThread("m3", 3), inThread("m4", 4)], true);
  const oldest = page([inThread("m1", 1), inThread("m2", 2)], false);
  const twoPages = (before: string | undefined) =>
    Promise.resolve(before === undefined ? newest : oldest);

  test("fetches the page before the oldest message held, puts it in front, and says when nothing older remains", async () => {
    const { conversation, asked } = pagedSetup(twoPages);
    conversation.start();
    await flush();
    expect(conversation.getState().hasEarlier).toBe(true);

    await conversation.loadEarlier();

    expect(asked).toEqual([undefined, "m3"]);
    expect(held(conversation)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(conversation.getState()).toMatchObject({
      hasEarlier: false,
      loadingEarlier: false,
      earlierError: null,
    });
  });

  test("shows that it is loading while the page comes, and asks once however often it is asked", async () => {
    const pending = deferred<MessagePage>();
    const { conversation, asked } = pagedSetup((before) =>
      before === undefined ? Promise.resolve(newest) : pending.promise,
    );
    conversation.start();
    await flush();

    const first = conversation.loadEarlier();
    const second = conversation.loadEarlier();
    expect(conversation.getState().loadingEarlier).toBe(true);
    pending.resolve(oldest);
    await Promise.all([first, second]);

    expect(asked).toEqual([undefined, "m3"]);
    expect(conversation.getState().loadingEarlier).toBe(false);
  });

  test("a failed fetch says why, keeps what is held, and can be tried again", async () => {
    let attempts = 0;
    const { conversation } = pagedSetup((before) => {
      if (before === undefined) return Promise.resolve(newest);
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("Host unreachable"))
        : Promise.resolve(oldest);
    });
    conversation.start();
    await flush();

    await conversation.loadEarlier();
    expect(conversation.getState()).toMatchObject({
      earlierError: "Host unreachable",
      loadingEarlier: false,
      hasEarlier: true,
    });
    expect(held(conversation)).toEqual(["m3", "m4"]);

    await conversation.loadEarlier();

    expect(held(conversation)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(conversation.getState().earlierError).toBeNull();
  });

  test("asks for nothing when the host has no older messages", async () => {
    const { conversation, asked } = pagedSetup(() => Promise.resolve(page([inThread("m1", 1)])));
    conversation.start();
    await flush();

    await conversation.loadEarlier();

    expect(asked).toEqual([undefined]);
  });

  test("the newest page fetched again keeps the older messages already loaded", async () => {
    const { conversation, fake } = pagedSetup((before) =>
      Promise.resolve(
        before === undefined
          ? page([inThread("m3", 3), inThread("m4", 4), inThread("m5", 5)], true)
          : oldest,
      ),
    );
    conversation.start();
    await flush();
    await conversation.loadEarlier();

    fake.resync();
    await flush();

    expect(held(conversation)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(conversation.getState().hasEarlier).toBe(false);
  });

  test("an older page that no longer joins what is held is dropped", async () => {
    const stale = deferred<MessagePage>();
    let newestAnswers = 0;
    const { conversation, fake } = pagedSetup((before) => {
      if (before !== undefined) return stale.promise;
      newestAnswers += 1;
      return Promise.resolve(
        newestAnswers === 1 ? newest : page([inThread("m9", 9), inThread("m10", 10)], true),
      );
    });
    conversation.start();
    await flush();
    const loading = conversation.loadEarlier();

    fake.resync();
    await flush();
    stale.resolve(oldest);
    await loading;

    expect(held(conversation)).toEqual(["m9", "m10"]);
    expect(conversation.getState().loadingEarlier).toBe(false);
  });
});
