import type { Context } from "hono";
import type { InboxError } from "./service.ts";
import type { SlackServiceError } from "./sources/slack/service.ts";

/** How the Inbox's refusals read over HTTP. */
export const inboxError = (c: Context, error: InboxError) => {
  switch (error.code) {
    case "NOT_FOUND":
      return c.json({ error: "Inbox item not found", code: error.code }, 404);
    case "NOT_CONNECTED":
      return c.json({ error: "Slack is not connected", code: error.code }, 409);
    case "SOURCE_FAILED":
      return c.json({ error: error.message, code: error.code }, 502);
    default:
      return c.json({ error: error.message, code: error.code }, 400);
  }
};

export const slackError = (c: Context, error: SlackServiceError) =>
  c.json(
    { error: slackErrorMessage(error), code: error.code },
    error.code === "NOT_CONNECTED" ? 409 : error.code === "NO_IMPORT" ? 404 : 400,
  );

export const slackErrorMessage = (error: SlackServiceError): string => {
  switch (error.code) {
    case "NOT_CONNECTED":
      return "Slack is not connected";
    case "NO_IMPORT":
      return "There are no saved test tokens to import";
    case "INVALID_TOKENS":
      return error.message;
  }
};
