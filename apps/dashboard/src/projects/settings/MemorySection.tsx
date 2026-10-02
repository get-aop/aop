import type { Project } from "@aop/common";
import { AutoMemory } from "./AutoMemory";
import { MemoryRequestBar } from "./MemoryRequestBar";
import { useMemoryFiles } from "./use-memory-files";
import { useMemoryRequest } from "./use-memory-request";

/**
 * The memory agents keep (the instructions the person writes are under General). The request
 * field is the screen's last child so it stays pinned to the bottom of the pane.
 */
export const MemorySection = ({ project }: { project: Project }) => {
  const memory = useMemoryFiles(project.id);
  // The coordinator has changed the files by the time it answers.
  const request = useMemoryRequest(project.id, memory.refresh);

  return (
    <div data-testid="settings-memory" className="flex flex-col">
      <AutoMemory memory={memory} />
      <MemoryRequestBar request={request} />
    </div>
  );
};
