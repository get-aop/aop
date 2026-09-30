import { formatRuntimeModelLabel, type ModelUsage, type ProjectUsageThread } from "@aop/common";
import { Link, threadPath } from "../../shell/router";
import { SettingsBlock } from "./blocks";
import { formatCost, formatShare, formatTokens } from "./format";
import { totalTokens } from "./usage-math";

/** A token count, compact once it is large; the exact number is one hover away and in `data-value`. */
export const TokenCount = ({ value }: { value: number }) => (
  <span data-value={value} title={value.toLocaleString("en-US")}>
    {formatTokens(value)}
  </span>
);

const CELL = "px-3 py-2 text-right tabular-nums";
const HEAD = "px-3 py-2 text-right text-[11.5px] font-medium text-text-subtle";

/** Where the tokens went by model: one row per model the project's runs used. */
export const UsageByModel = ({ models }: { models: readonly ModelUsage[] }) => (
  <SettingsBlock
    title="By model"
    description="What each model consumed across the coordinator and every thread."
    testId="usage-by-model"
  >
    <div className="overflow-x-auto rounded-row border border-border">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-border">
            <th className={`${HEAD} text-left`}>Model</th>
            <th className={HEAD}>Runs</th>
            <th className={HEAD}>Input</th>
            <th className={HEAD}>Output</th>
            <th className={HEAD}>Cache write</th>
            <th className={HEAD}>Cache read</th>
            <th className={HEAD}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
            <tr
              key={`${model.provider}:${model.model}`}
              data-testid="usage-model-row"
              data-model={model.model}
              className="border-b border-border last:border-b-0"
            >
              <td className="px-3 py-2 text-left text-text">
                {formatRuntimeModelLabel(model.model)}
              </td>
              <td className={CELL}>{model.runs}</td>
              <td className={CELL} data-cell="input">
                <TokenCount value={model.inputTokens} />
              </td>
              <td className={CELL} data-cell="output">
                <TokenCount value={model.outputTokens} />
              </td>
              <td className={CELL} data-cell="cache-write">
                <TokenCount value={model.cacheWriteTokens} />
              </td>
              <td className={CELL} data-cell="cache-read">
                <TokenCount value={model.cacheReadTokens} />
              </td>
              <td className={CELL} data-cell="cost">
                {model.costUsd === null ? "–" : formatCost(model.costUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </SettingsBlock>
);

/** One row per session that used tokens, the biggest consumer first, with its share of the whole. */
export const UsageByThread = ({
  projectId,
  threads,
  total,
}: {
  projectId: string;
  threads: readonly ProjectUsageThread[];
  total: number;
}) => (
  <SettingsBlock
    title="By thread"
    description="The coordinator and every thread that used tokens in this window."
    testId="usage-by-thread"
  >
    <div className="overflow-x-auto rounded-row border border-border">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-border">
            <th className={`${HEAD} text-left`}>Session</th>
            <th className={`${HEAD} text-left`}>Model</th>
            <th className={HEAD}>Tokens</th>
            <th className={HEAD}>Share</th>
            <th className={HEAD}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {threads.map((thread) => {
            const tokens = totalTokens(thread);
            return (
              <tr
                key={thread.threadId}
                data-testid="usage-thread-row"
                data-thread-id={thread.threadId}
                data-kind={thread.kind}
                className="border-b border-border last:border-b-0"
              >
                <td className="max-w-64 truncate px-3 py-2 text-left text-text">
                  {thread.kind === "coordinator" ? (
                    <span>Coordinator</span>
                  ) : (
                    <Link to={threadPath(projectId, thread.threadId)} className="hover:underline">
                      {thread.title}
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2 text-left text-text-muted">
                  {thread.models.map(formatRuntimeModelLabel).join(", ") || "–"}
                </td>
                <td className={CELL} data-cell="tokens">
                  <TokenCount value={tokens} />
                </td>
                <td className={CELL} data-cell="share">
                  {formatShare(tokens, total)}
                </td>
                <td className={CELL} data-cell="cost">
                  {thread.costUsd === null ? "–" : formatCost(thread.costUsd)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </SettingsBlock>
);
