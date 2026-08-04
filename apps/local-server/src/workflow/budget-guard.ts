import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { SettingKey } from "../settings/types.ts";

export type BudgetGuardResult = { ok: true } | { ok: false; message: string; reasons: string[] };

export const validateTaskBudget = async (
  ctx: LocalServerContext,
  task: Task,
): Promise<BudgetGuardResult> => {
  const [wallClockCeilingSecs, costCeilingUsd, tokenCeiling] = await Promise.all([
    ctx.settingsRepository.get(SettingKey.BUDGET_WALL_CLOCK_SECS),
    ctx.settingsRepository.get(SettingKey.BUDGET_COST_USD),
    ctx.settingsRepository.get(SettingKey.BUDGET_TOTAL_TOKENS),
  ]);

  const wallClockCeiling = parsePositiveNumber(wallClockCeilingSecs);
  const costCeiling = parsePositiveNumber(costCeilingUsd);
  const tokenCeilingInt = parsePositiveInt(tokenCeiling);

  if (!wallClockCeiling && !costCeiling && !tokenCeilingInt) {
    return { ok: true };
  }

  const usageRecords = await ctx.executionRepository.getTaskUsage(task.id);

  const totalDurationMs = usageRecords.reduce((sum, record) => sum + (record.duration_ms ?? 0), 0);
  const totalCostUsd = usageRecords.reduce((sum, record) => sum + (record.cost_usd ?? 0), 0);
  const totalTokens = usageRecords.reduce((sum, record) => sum + (record.total_tokens ?? 0), 0);

  const reasons: string[] = [];

  if (wallClockCeiling && totalDurationMs / 1000 > wallClockCeiling) {
    reasons.push(
      `wall-clock ${(totalDurationMs / 1000).toFixed(1)}s exceeds ceiling ${wallClockCeiling}s`,
    );
  }

  if (costCeiling && totalCostUsd > costCeiling) {
    reasons.push(`cost $${totalCostUsd.toFixed(4)} exceeds ceiling $${costCeiling.toFixed(4)}`);
  }

  if (tokenCeilingInt && totalTokens > tokenCeilingInt) {
    reasons.push(`tokens ${totalTokens} exceed ceiling ${tokenCeilingInt}`);
  }

  return reasons.length > 0 ? { ok: false, reasons, message: reasons.join("; ") } : { ok: true };
};

const parsePositiveNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const num = Number(value);
  if (Number.isNaN(num) || num <= 0) return undefined;
  return num;
};

const parsePositiveInt = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const num = Number(value);
  if (Number.isNaN(num) || num <= 0 || !Number.isInteger(num)) return undefined;
  return num;
};
