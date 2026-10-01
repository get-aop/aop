import { MEMORY_INDEX_NAME } from "@aop/common";

/**
 * What the coordinator is told when the person asks, from Memory settings, for memory to change.
 * The settings screen shows the memory files and nothing else, so the reply is a short account
 * of which files changed, and the work stays with the coordinator: no thread is needed for it.
 */
export const memoryRequestPrompt = (request: string): string =>
  [
    "The person asked, from the project's Memory settings, for a change to the project's memory:",
    "",
    "<request>",
    request,
    "</request>",
    "",
    `Make the change yourself with memory_read, memory_write and memory_delete: read the files it concerns first, keep ${MEMORY_INDEX_NAME} a short index that points to topic files, file something new to remember in the topic file it belongs to (or a new one the index points to), and when something is to be removed, take it out of every file that says it. Do not start a thread for this. Then reply in one or two sentences naming the files you changed, or why you changed nothing.`,
  ].join("\n");
