export interface ArgvSpec {
  /** Flags that consume exactly one following argument. */
  valueFlags: readonly string[];
  /** Flags that consume every following argument up to the next `--flag`. */
  variadicFlags?: readonly string[];
}

export interface ParsedArgv {
  /** Every `--flag` in order, whether or not the spec knows it; values and positionals are not flags. */
  flags: string[];
  values: Map<string, string>;
  /** What each variadic flag consumed, in order; a repeated flag accumulates. */
  variadicValues: Map<string, string[]>;
  positionals: string[];
}

/** Splits argv into flag values and positionals, the way the real CLIs' option parsers do. */
export const parseArgv = (args: readonly string[], spec: ArgvSpec): ParsedArgv => {
  const parsed: ParsedArgv = {
    flags: [],
    values: new Map(),
    variadicValues: new Map(),
    positionals: [],
  };
  let index = 0;
  while (index < args.length) {
    const arg = args[index] as string;
    if (arg.startsWith("--")) parsed.flags.push(arg);
    index = consume(args, index + 1, arg, spec, parsed);
  }
  return parsed;
};

// Takes what follows `arg` (at `from`) as its values and returns where the next argument starts.
const consume = (
  args: readonly string[],
  from: number,
  arg: string,
  spec: ArgvSpec,
  parsed: ParsedArgv,
): number => {
  if (spec.valueFlags.includes(arg)) {
    parsed.values.set(arg, args[from] ?? "");
    return from + 1;
  }
  if (spec.variadicFlags?.includes(arg)) {
    const end = variadicEnd(args, from);
    const consumed = args.slice(from, end);
    parsed.variadicValues.set(arg, [...(parsed.variadicValues.get(arg) ?? []), ...consumed]);
    return end;
  }
  if (!arg.startsWith("--")) parsed.positionals.push(arg);
  return from;
};

// A variadic flag swallows a trailing prompt exactly like the real parser would,
// so a missing positional here surfaces an adapter argv-ordering bug.
const variadicEnd = (args: readonly string[], from: number): number => {
  let index = from;
  while (index < args.length && !(args[index] as string).startsWith("--")) index += 1;
  return index;
};
