import { existsSync, readFileSync, statSync } from "node:fs";

export interface LogFileSnapshot {
  lines: string[];
  lineCount: number;
}

export const readAllLogLines = (logFile: string): string[] => {
  if (!existsSync(logFile)) {
    return [];
  }

  const content = readFileSync(logFile, "utf-8");
  return content.split("\n").filter((line) => line.length > 0);
};

export const readLogLineCount = (logFile: string): number => readAllLogLines(logFile).length;

export const readLogLines = (logFile: string, offset = 0): LogFileSnapshot => {
  const allLines = readAllLogLines(logFile);
  const lines = offset > 0 ? allLines.slice(offset) : allLines;
  return { lines, lineCount: allLines.length };
};

export const getFileSize = (logFile: string): number => {
  try {
    return statSync(logFile).size;
  } catch {
    return 0;
  }
};
