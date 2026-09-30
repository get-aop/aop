/**
 * How many project streams one page keeps open. A browser allows six HTTP/1.1 connections to
 * one host and a stream holds its connection for as long as it lives, so an unbounded set would
 * leave no connection for the requests that fetch, create and change things. Four leaves two.
 */
export const MAX_LIVE_STREAMS = 4;

/**
 * Which projects get a stream. The open project always does. Streams already open stay open
 * while their project is still eligible, so a change elsewhere never makes streams come and go;
 * free slots go to the most recently changed projects. `eligible` is ordered most recent first.
 * When over the cap, the oldest-opened stream that is not the open project's is dropped.
 */
export const nextWatchSet = (
  current: readonly string[],
  eligible: readonly string[],
  selectedId: string | null,
  max: number = MAX_LIVE_STREAMS,
): string[] => {
  const result = current.filter((id) => eligible.includes(id));
  if (selectedId !== null && eligible.includes(selectedId) && !result.includes(selectedId)) {
    result.push(selectedId);
  }
  for (const id of eligible) {
    if (result.length >= max) break;
    if (!result.includes(id)) result.push(id);
  }
  while (result.length > max) {
    const oldest = result.findIndex((id) => id !== selectedId);
    result.splice(oldest, 1);
  }
  return result;
};
