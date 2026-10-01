import { formatRuntimeModelLabel, type ModelUsage } from "@aop/common";
import { SettingsBlock } from "./blocks";
import { formatTokens, formatWholeCents } from "./format";
import { apportionCents } from "./usage-math";

/** A token count, compact once it is large; the exact number is one hover away and in `data-value`. */
export const TokenCount = ({ value }: { value: number }) => (
  <span data-value={value} title={value.toLocaleString("en-US")}>
    {formatTokens(value)}
  </span>
);

const CELL = "px-3 py-2 text-right tabular-nums";
const HEAD = "px-3 py-2 text-right text-[11.5px] font-medium text-text-subtle";

// Whole cents come from the column as a whole (`apportionCents`), so its rows add up to the total.
const Cost = ({ usd, cents }: { usd: number | null; cents: number | null }) =>
  usd === null || cents === null ? "–" : formatWholeCents(cents, usd);

/** Where the tokens went by model: one row per model the project's runs used. */
export const UsageByModel = ({ models }: { models: readonly ModelUsage[] }) => {
  const cents = apportionCents(models.map((model) => model.costUsd));
  return (
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
            {models.map((model, index) => (
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
                  <Cost usd={model.costUsd} cents={cents[index] ?? null} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SettingsBlock>
  );
};
