import { getLogger } from "@aop/infra";
import { fetchServer } from "./client.ts";

const logger = getLogger("cli", "session-workspace");

export const sessionWorkspaceSetCommand = async (
  sessionId: string,
  absolutePath: string,
): Promise<void> => {
  const result = await fetchServer<{ session: { workspacePath: string } }>(
    `/api/chat-sessions/${sessionId}/workspace`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: absolutePath }),
    },
  );
  if (!result.ok) throw new Error(result.error.error);
  logger.info("Chat workspace set to {path}", { path: result.data.session.workspacePath });
};

export const sessionWorkspaceResetCommand = async (sessionId: string): Promise<void> => {
  const result = await fetchServer<{ session: { workspacePath: string } }>(
    `/api/chat-sessions/${sessionId}/workspace`,
    { method: "DELETE" },
  );
  if (!result.ok) throw new Error(result.error.error);
  logger.info("Chat workspace reset to {path}", { path: result.data.session.workspacePath });
};
