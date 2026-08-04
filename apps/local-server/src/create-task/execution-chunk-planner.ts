import type { BrainstormingResult } from "@aop/common";
import type { TaskScopeComplexity } from "./normalize-scope.ts";
import { estimateTaskScopeComplexity } from "./normalize-scope.ts";
import {
  classifyWorkArea,
  countImplementationAreas,
  dedupeTrimmedItems,
  type WorkArea,
} from "./scope-utils.ts";

export interface ExecutionChunk {
  title: string;
  description: string;
  dependencies: number[];
}

const CHUNK_TARGETS: Record<TaskScopeComplexity, { min: number; max: number }> = {
  simple: { min: 1, max: 1 },
  standard: { min: 2, max: 3 },
  complex: { min: 3, max: 5 },
};

/** Brainstorm-provided execution shape is authoritative within this band. */
const EXPLICIT_EXECUTION_CHUNK_MIN = 2;
const EXPLICIT_EXECUTION_CHUNK_MAX = 5;

const AREA_ORDER: WorkArea[] = ["backend", "frontend", "verification", "general"];

/** Derive worker execution chunks from task scope — separate from requirements. */
export const planExecutionChunks = (result: BrainstormingResult): ExecutionChunk[] => {
  const complexity = estimateExecutionComplexity(result);
  const requirements = dedupeTrimmedItems(result.requirements);

  if (result.executionChunks && result.executionChunks.length > 0) {
    return normalizeProvidedChunks(result.executionChunks, result, complexity, requirements);
  }

  if (requirements.length === 0) {
    return [
      {
        title: result.title,
        description: result.description.trim() || result.title,
        dependencies: [],
      },
    ];
  }

  return planChunksFromScope(result, requirements, complexity);
};

export const estimateExecutionComplexity = (result: BrainstormingResult): TaskScopeComplexity => {
  const requirements = dedupeTrimmedItems(result.requirements);
  const implementationAreas = countImplementationAreas(requirements);

  if (implementationAreas <= 1 && requirements.length <= 4) return "simple";
  if (implementationAreas >= 2 && requirements.length >= 4) return "complex";
  if (implementationAreas >= 2) return "standard";

  return estimateTaskScopeComplexity(result);
};

const planChunksFromScope = (
  result: BrainstormingResult,
  requirements: string[],
  complexity: TaskScopeComplexity,
): ExecutionChunk[] => {
  if (complexity === "simple") {
    return [buildSingleChunk(result, requirements)];
  }

  const buckets = bucketRequirements(requirements);
  let chunks = bucketsToChunks(buckets, result.title);

  chunks = foldVerificationIntoImplementation(chunks, complexity);
  chunks = fitChunkCount(chunks, CHUNK_TARGETS[complexity]);

  return withLinearDependencies(chunks);
};

const buildSingleChunk = (result: BrainstormingResult, requirements: string[]): ExecutionChunk => ({
  title: result.title,
  description: buildChunkDescription(result.description, requirements),
  dependencies: [],
});

const bucketRequirements = (requirements: string[]): Map<WorkArea, string[]> => {
  const buckets = new Map<WorkArea, string[]>();

  for (const requirement of requirements) {
    const area = classifyWorkArea(requirement);
    const bucket = buckets.get(area) ?? [];
    bucket.push(requirement);
    buckets.set(area, bucket);
  }

  return buckets;
};

const bucketsToChunks = (buckets: Map<WorkArea, string[]>, taskTitle: string): ExecutionChunk[] => {
  const chunks: ExecutionChunk[] = [];

  for (const area of AREA_ORDER) {
    const items = buckets.get(area);
    if (!items || items.length === 0) continue;

    chunks.push({
      title: buildAreaChunkTitle(area, items, taskTitle),
      description: formatRequirementBullets(items),
      dependencies: [],
    });
  }

  return chunks.length > 0
    ? chunks
    : [{ title: taskTitle, description: taskTitle, dependencies: [] }];
};

const foldVerificationIntoImplementation = (
  chunks: ExecutionChunk[],
  complexity: TaskScopeComplexity,
): ExecutionChunk[] => {
  const verificationIndex = chunks.findIndex((chunk) => isVerificationChunk(chunk.title));
  if (verificationIndex === -1) return chunks;

  const verificationChunk = chunks[verificationIndex];
  if (!verificationChunk) return chunks;

  const implementationChunks = chunks.filter((_, index) => index !== verificationIndex);
  if (implementationChunks.length === 0) return chunks;

  const verificationItems = parseRequirementBullets(verificationChunk.description);
  const shouldKeepSeparate =
    complexity === "complex" &&
    implementationChunks.length >= 2 &&
    verificationItems.length >= 2 &&
    isSubstantialVerification(verificationChunk.description);

  if (shouldKeepSeparate) return chunks;

  const target = pickVerificationHostChunk(implementationChunks);
  target.description = buildChunkDescription(target.description, verificationItems);

  return implementationChunks;
};

const fitChunkCount = (
  chunks: ExecutionChunk[],
  target: { min: number; max: number },
): ExecutionChunk[] => {
  let next = [...chunks];

  while (next.length > target.max) {
    next = mergeSmallestAdjacentChunks(next);
  }

  while (next.length < target.min && next.length > 1) {
    break;
  }

  if (next.length === 0) {
    return chunks.slice(0, 1);
  }

  return next;
};

const mergeSmallestAdjacentChunks = (chunks: ExecutionChunk[]): ExecutionChunk[] => {
  if (chunks.length <= 1) return chunks;

  let mergeIndex = 0;
  let smallestCombinedLength = Number.POSITIVE_INFINITY;

  for (let index = 0; index < chunks.length - 1; index += 1) {
    const left = chunks[index];
    const right = chunks[index + 1];
    if (!left || !right) continue;

    const combinedLength = left.description.length + right.description.length;
    if (combinedLength < smallestCombinedLength) {
      smallestCombinedLength = combinedLength;
      mergeIndex = index;
    }
  }

  const left = chunks[mergeIndex];
  const right = chunks[mergeIndex + 1];
  if (!left || !right) return chunks;

  const merged = mergeChunks(left, right);
  return [...chunks.slice(0, mergeIndex), merged, ...chunks.slice(mergeIndex + 2)];
};

const mergeChunks = (left: ExecutionChunk, right: ExecutionChunk): ExecutionChunk => ({
  title: left.title.length >= right.title.length ? left.title : right.title,
  description: buildChunkDescription(left.description, parseRequirementBullets(right.description)),
  dependencies: [],
});

const normalizeProvidedChunks = (
  executionChunks: string[],
  result: BrainstormingResult,
  complexity: TaskScopeComplexity,
  requirements: string[],
): ExecutionChunk[] => {
  const titles = dedupeTrimmedItems(executionChunks);

  if (titles.length === 0) {
    return planChunksFromScope(result, requirements, complexity);
  }

  if (titles.length === 1) {
    const title = titles[0] ?? result.title;
    return withLinearDependencies([
      {
        title,
        description: buildChunkDescription(result.description, requirements),
        dependencies: [],
      },
    ]);
  }

  const assignments = assignRequirementsToExplicitChunkTitles(titles, requirements);
  let chunks: ExecutionChunk[] = titles.map((title, index) => ({
    title,
    description: buildProvidedChunkDescription(assignments[index] ?? [], title),
    dependencies: [],
  }));

  if (
    titles.length >= EXPLICIT_EXECUTION_CHUNK_MIN &&
    titles.length <= EXPLICIT_EXECUTION_CHUNK_MAX
  ) {
    return withLinearDependencies(chunks);
  }

  chunks = fitChunkCount(chunks, {
    min: EXPLICIT_EXECUTION_CHUNK_MIN,
    max: EXPLICIT_EXECUTION_CHUNK_MAX,
  });
  return withLinearDependencies(chunks);
};

const assignRequirementsToExplicitChunkTitles = (
  titles: string[],
  requirements: string[],
): string[][] => {
  const assignments = titles.map(() => [] as string[]);

  for (const requirement of requirements) {
    const index = pickBestChunkIndexForRequirement(
      titles,
      requirement,
      assignments,
      scoreExplicitChunkTitleForRequirement,
    );
    assignments[index]?.push(requirement);
  }

  return assignments;
};

const pickBestChunkIndexForRequirement = (
  titles: string[],
  requirement: string,
  assignments: string[][],
  scoreRequirement: (chunkTitle: string, requirement: string) => number,
): number => {
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < titles.length; index += 1) {
    const title = titles[index];
    if (!title) continue;

    const score = scoreRequirement(title, requirement);
    const loadPenalty = (assignments[index]?.length ?? 0) * 0.1;
    const adjustedScore = score - loadPenalty;

    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestIndex = index;
    }
  }

  return bestIndex;
};

const scoreExplicitChunkTitleForRequirement = (chunkTitle: string, requirement: string): number => {
  const title = chunkTitle.toLowerCase();
  const normalizedRequirement = requirement.toLowerCase();
  let score = 0;

  for (const token of tokenizeForMatch(requirement)) {
    if (title.includes(token)) score += 1;
  }

  for (const keyword of EXPLICIT_CHUNK_KEYWORDS) {
    if (normalizedRequirement.includes(keyword) && title.includes(keyword)) {
      score += 4;
    }
  }

  return score;
};

const EXPLICIT_CHUNK_KEYWORDS = [
  "sort",
  "pending",
  "tab",
  "reviewed",
  "review",
  "test",
  "docs",
  "documentation",
] as const;

const tokenizeForMatch = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4);

const buildProvidedChunkDescription = (requirements: string[], title: string): string => {
  if (requirements.length === 0) return title;
  return formatRequirementBullets(requirements);
};

const withLinearDependencies = (chunks: ExecutionChunk[]): ExecutionChunk[] =>
  chunks.map((chunk, index) => ({
    ...chunk,
    dependencies: index === 0 ? [] : [index],
  }));

const buildAreaChunkTitle = (area: WorkArea, items: string[], taskTitle: string): string => {
  switch (area) {
    case "backend":
      return `Update backend ${summarizeAreaTopic(items)}`;
    case "frontend":
      return `Update frontend ${summarizeAreaTopic(items)}`;
    case "verification":
      return "Verify regressions and documentation";
    case "general":
      return items.length === 1 && items[0] ? items[0] : taskTitle;
  }
};

const summarizeAreaTopic = (items: string[]): string => {
  const source = items[0] ?? "behavior";
  const normalized = source
    .replace(/^(change|update|add|remove|hide|keep|preserve)\s+/i, "")
    .replace(/\s+for\s+this\s+release$/i, "")
    .trim();

  return normalized.length > 0 ? normalized.toLowerCase() : "behavior";
};

const buildChunkDescription = (intro: string, requirements: string[]): string => {
  const trimmedIntro = intro.trim();
  const bullets = formatRequirementBullets(requirements);

  if (trimmedIntro.length === 0) return bullets;
  if (requirements.length === 0) return trimmedIntro;

  return `${trimmedIntro}\n\n${bullets}`;
};

const formatRequirementBullets = (requirements: string[]): string =>
  requirements.map((item) => `- ${item}`).join("\n");

const parseRequirementBullets = (description: string): string[] =>
  description
    .split("\n")
    .map((line) => line.replace(/^\s*-\s+/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("Also verified:"));

const isVerificationChunk = (title: string): boolean =>
  /\b(verify|verification|regression|documentation|docs|test)\b/i.test(title);

const isSubstantialVerification = (description: string): boolean => {
  const items = parseRequirementBullets(description);
  const text = description.toLowerCase();
  return (
    items.length >= 3 ||
    (/\b(integration|e2e|openapi|migration)\b/i.test(text) && items.length >= 2)
  );
};

const pickVerificationHostChunk = (chunks: ExecutionChunk[]): ExecutionChunk => {
  const backendChunk = chunks.find((chunk) => /\bbackend\b/i.test(chunk.title));
  if (backendChunk) return backendChunk;

  return chunks.reduce((largest, chunk) =>
    chunk.description.length > largest.description.length ? chunk : largest,
  );
};
