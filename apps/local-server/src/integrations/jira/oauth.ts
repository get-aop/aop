import { randomBytes } from "node:crypto";
import type { JiraAuthorizationRequest, JiraCallbackParams, JiraOAuth } from "./oauth-types.ts";

const JIRA_AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
const JIRA_AUDIENCE = "api.atlassian.com";
const DEFAULT_SCOPE = "read:jira-work read:jira-user offline_access";

export const createJiraOAuth = (options: {
  clientId: string;
  redirectUri: string;
  scope?: string;
}): JiraOAuth => {
  const scope = options.scope ?? DEFAULT_SCOPE;
  const issuedStates = new Set<string>();

  const createAuthorizationRequest = (): JiraAuthorizationRequest => {
    const state = createOpaqueValue();
    const url = new URL(JIRA_AUTHORIZE_URL);

    url.searchParams.set("audience", JIRA_AUDIENCE);
    url.searchParams.set("client_id", options.clientId);
    url.searchParams.set("scope", scope);
    url.searchParams.set("redirect_uri", options.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("prompt", "consent");

    issuedStates.add(state);

    return { url, state };
  };

  const validateCallback = (params: JiraCallbackParams): { code: string; state: string } => {
    if (params.error) {
      throw new Error(`Jira OAuth error: ${params.error}`);
    }

    const state = getRequiredString(params.state, "Invalid Jira OAuth state");
    const code = getRequiredString(params.code, "Missing Jira OAuth authorization code");

    if (!issuedStates.has(state)) {
      throw new Error("Invalid Jira OAuth state");
    }
    issuedStates.delete(state);

    return { code, state };
  };

  return {
    createAuthorizationRequest,
    validateCallback,
  };
};

const createOpaqueValue = (): string => randomBytes(32).toString("base64url");

const getRequiredString = (value: string | null | undefined, message: string): string => {
  if (!value) {
    throw new Error(message);
  }
  return value;
};
