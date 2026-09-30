export interface ArgvSpec {
  /** Flags that consume exactly one following argument. */
  valueFlags: readonly string[];
  /** Flags that consume every following argument up to the next `--flag`. */
  variadicFlags?: readonly string[];
}

export interface ParsedArgv {
  values: Map<string, string>;
  /** What each variadic flag consumed, in order; a repeated flag accumulates. */
  variadicValues: Map<string, string[]>;
  positionals: string[];
}

/** Splits argv into flag values and positionals, the way the real CLIs' option parsers do. */
export const parseArgv = (args: readonly string[], spec: ArgvSpec): ParsedArgv => {
  const parsed: ParsedArgv = { values: new Map(), variadicValues: new Map(), positionals: [] };
  let index = 0;
  while (index < args.length) {
    const arg = args[index] as string;
    index += 1;
    if (spec.valueFlags.includes(arg)) {
      parsed.values.set(arg, args[index] ?? "");
      index += 1;
    } else if (spec.variadicFlags?.includes(arg)) {
      const end = variadicEnd(args, index);
      const consumed = args.slice(index, end);
      parsed.variadicValues.set(arg, [...(parsed.variadicValues.get(arg) ?? []), ...consumed]);
      index = end;
    } else if (!arg.startsWith("--")) {
      parsed.positionals.push(arg);
    }
  }
  return parsed;
};

// A variadic flag swallows a trailing prompt exactly like the real parser would,
// so a missing positional here surfaces an adapter argv-ordering bug.
const variadicEnd = (args: readonly string[], from: number): number => {
  let index = from;
  while (index < args.length && !(args[index] as string).startsWith("--")) index += 1;
  return index;
};
