/** Legacy source installs stored a fixed port-4310 callback; map it to this server's URL. */
export const resolveLinearCallbackUrl = ({
  configuredCallbackUrl,
  env,
}: {
  configuredCallbackUrl: string;
  env: NodeJS.ProcessEnv;
}): string => {
  if (!configuredCallbackUrl.length) {
    return getDefaultLinearCallbackUrl(env);
  }

  return isLegacyLinearCallbackUrl(configuredCallbackUrl)
    ? getDefaultLinearCallbackUrl(env)
    : configuredCallbackUrl;
};

const getDefaultLinearCallbackUrl = (env: NodeJS.ProcessEnv): string => {
  const callbackBase =
    env.AOP_LINEAR_CALLBACK_BASE ?? env.AOP_LOCAL_SERVER_URL ?? "http://127.0.0.1:4310";
  return new URL("/api/linear/callback", callbackBase).toString();
};

const isLegacyLinearCallbackUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === "4310" &&
      url.pathname === "/api/linear/callback"
    );
  } catch {
    return false;
  }
};
