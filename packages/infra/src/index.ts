export { useTestAopHome } from "./aop-paths.test-utils.ts";
export { aopPaths } from "./aop-paths.ts";

export {
  commandExistsInvocation,
  type ExecHost,
  type ExecHostKind,
  type ExecHostShellOptions,
  type ExecHostSpawnSpec,
  type ExecHostStdio,
  NativeUnixHost,
  NativeWindowsHost,
  resolveExecHost,
  resolveUnixShell,
  shellInvocation,
} from "./exec-host.ts";
export {
  type PathMapEntry,
  remoteScript,
  SshExecHost,
  type SshExecHostOptions,
  type SshHostConfig,
  type SshSpawnImpl,
  sanitizeForwardedEnv,
  shellQuote,
  sshBaseArgs,
  sshInvocation,
  sshTarget,
} from "./exec-host-ssh.ts";
export {
  createFileOutputHandler,
  type FileOutputHandlerOptions,
  type OutputHandler,
} from "./file-output-handler.ts";

export {
  cleanupLoggers,
  configureLogging,
  flushLogs,
  getLogger,
  type Logger,
  type LoggingOptions,
  type LogLevel,
  resetLogging,
} from "./logger.ts";
export { type CrudHelpers, createCrudHelpers } from "./repository-helpers.ts";
export { buildClaudeCodeSpawnEnv, buildSpawnEnv } from "./spawn-env.ts";
export {
  getActiveSpanId,
  getActiveTraceId,
  getTracer,
  getTracerProvider,
  initTracing,
  injectTraceHeaders,
  resetTracing,
  runWithSpan,
} from "./tracing.ts";
export {
  generateTypeId,
  getTypeIdPrefix,
  isValidTypeId,
  type TypeIdPrefix,
} from "./typeid.ts";
export { isWindowsPath, windowsToWsl, wslToWindows } from "./wsl-path.ts";
