import { useCallback, useEffect, useRef, useState } from "react";
import { createHostEventsConnection, type HostEvent } from "../api/events";
import { getRepos, type RegisteredRepo } from "../api/settings";
import { receiveChatUnread } from "./use-chat-unread";

/** Global host event stream: registered repos, connection state, chat-unread pushes. */
export const useHostEvents = () => {
  const [repos, setRepos] = useState<RegisteredRepo[]>([]);
  const [connected, setConnected] = useState(false);
  const refreshSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    const latest = await getRepos();
    // A newer refresh started while this one was in flight: its result wins.
    if (seq === refreshSeqRef.current) setRepos(latest);
  }, []);

  useEffect(() => {
    const handleEvent = (event: HostEvent) => {
      switch (event.type) {
        case "init":
          setRepos(event.data.repos);
          break;
        case "repo-removed":
        case "data-reset":
          void refresh().catch(() => {});
          break;
        case "chat-unread":
          receiveChatUnread(event.data);
          break;
      }
    };
    const connection = createHostEventsConnection({
      onEvent: handleEvent,
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),
    });
    return () => connection.close();
  }, [refresh]);

  return { repos, connected, refresh };
};
