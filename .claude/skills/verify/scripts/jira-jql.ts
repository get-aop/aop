/**
 * A small JQL parser for the fake Jira site: enough for what AOP sends and for queries a person
 * types by hand. Clauses (fields in jira-jql-fields.ts) combine with AND, OR, NOT and
 * parentheses, then an optional `ORDER BY updated DESC, key`. Anything else is rejected with
 * the message Jira gives, so a check can see the host surface it.
 */
import type { IssueSpec } from "./jira-catalog.ts";
import { FIELDS, type FieldDef, JqlError, SORT_KEYS } from "./jira-jql-fields.ts";
import { ME } from "./jira-people.ts";

export { JqlError } from "./jira-jql-fields.ts";

type Predicate = (issue: IssueSpec) => boolean;
type SortKey = (issue: IssueSpec) => number | string;

export interface Jql {
  /** Null when the query has no clauses (only ORDER BY, or nothing): "unbounded". */
  where: Predicate | null;
  orderBy: { field: string; desc: boolean }[];
}

/** Parses a query or throws JqlError with Jira's message. */
export function parseJql(source: string): Jql {
  return new Parser(tokenize(source)).query();
}

/** The issues a query matches, in its order (key descending when it names none). */
export function runJql(jql: Jql, issues: IssueSpec[]): IssueSpec[] {
  const where = jql.where;
  const matched = where ? issues.filter((issue) => where(issue)) : [...issues];
  const orderBy = jql.orderBy.length > 0 ? jql.orderBy : [{ field: "key", desc: true }];
  return matched.sort((a, b) => compareBy(orderBy, a, b));
}

const query = (message: string) => new JqlError(`Error in the JQL Query: ${message}`);

interface Token {
  kind: "string" | "word" | "op" | "punct";
  value: string;
  at: number;
}

const TOKEN =
  /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(!=|!~|>=|<=|=|~|>|<)|([(),])|([^\s=!~<>(),"']+))/y;

function tokenize(source: string): Token[] {
  const pattern = new RegExp(TOKEN.source, "y");
  const tokens: Token[] = [];
  while (source.slice(pattern.lastIndex).trim() !== "") {
    const at = pattern.lastIndex;
    const match = pattern.exec(source);
    if (!match) throw badCharacter(source, at);
    tokens.push(tokenOf(match, at));
  }
  return tokens;
}

function badCharacter(source: string, at: number): JqlError {
  const rest = source.slice(at).trim();
  const where = `(line 1, character ${source.indexOf(rest, at) + 1})`;
  if (/^["']/.test(rest))
    return query(`The quoted string '${rest}' has not been completed. ${where}`);
  return query(`The character '${rest[0]}' is a reserved JQL character. ${where}`);
}

function tokenOf(match: RegExpExecArray, at: number): Token {
  const [, double, single, op, punct, word] = match;
  if (double !== undefined || single !== undefined) {
    return { kind: "string", value: (double ?? single ?? "").replace(/\\(.)/g, "$1"), at };
  }
  if (op !== undefined) return { kind: "op", value: op, at };
  if (punct !== undefined) return { kind: "punct", value: punct, at };
  return { kind: "word", value: word ?? "", at };
}

interface Value {
  text: string;
  empty: boolean;
}

const OPERATORS = "'=', '!=', '<', '>', '<=', '>=', '~', '!~', 'IN', 'NOT IN', 'IS' and 'IS NOT'";

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  query(): Jql {
    const where = this.atEnd() || this.peekWord("order") ? null : this.or();
    const orderBy = this.acceptWord("order") ? this.orderBy() : [];
    if (!this.atEnd()) throw this.unexpected("either 'OR' or 'AND'");
    return { where, orderBy };
  }

  private or(): Predicate {
    const parts = [this.and()];
    while (this.acceptWord("or")) parts.push(this.and());
    return (issue) => parts.some((part) => part(issue));
  }

  private and(): Predicate {
    const parts = [this.unary()];
    while (this.acceptWord("and")) parts.push(this.unary());
    return (issue) => parts.every((part) => part(issue));
  }

  private unary(): Predicate {
    if (this.acceptWord("not")) {
      const inner = this.unary();
      return (issue) => !inner(issue);
    }
    if (this.accept("(")) {
      const inner = this.or();
      this.expect(")");
      return inner;
    }
    return this.clause();
  }

  private clause(): Predicate {
    const token = this.next("a field name");
    const field = FIELDS[token.value.toLowerCase()];
    if (!field || token.kind === "punct" || token.kind === "op") {
      throw query(
        `Field '${token.value}' does not exist or you do not have permission to view it.`,
      );
    }
    const operator = this.operator();
    if (!field.operators.includes(operator)) {
      throw query(
        `The operator '${operator.toUpperCase()}' is not supported by the '${field.name}' field.`,
      );
    }
    const values = operator.endsWith("in") ? this.list() : [this.value()];
    return compileClause(field, operator, values);
  }

  private operator(): string {
    const token = this.next("operator");
    if (token.kind === "op") return token.value;
    const word = token.value.toLowerCase();
    if (word === "in") return "in";
    if (word === "is") return this.acceptWord("not") ? "is not" : "is";
    if (word === "not" && this.acceptWord("in")) return "not in";
    this.index--;
    throw this.unexpected(`operator`, ` The valid operators are ${OPERATORS}.`);
  }

  private list(): Value[] {
    this.expect("(");
    const values = [this.value()];
    while (this.accept(",")) values.push(this.value());
    this.expect(")");
    return values;
  }

  private value(): Value {
    const token = this.next("either a value, list or function");
    if (token.kind === "string") return { text: token.value, empty: false };
    if (token.kind !== "word") {
      this.index--;
      throw this.unexpected("either a value, list or function");
    }
    if (this.accept("(")) {
      this.expect(")");
      return callFunction(token.value);
    }
    return { text: token.value, empty: ["empty", "null"].includes(token.value.toLowerCase()) };
  }

  private orderBy(): Jql["orderBy"] {
    if (!this.acceptWord("by")) throw this.unexpected("'BY'");
    const sorts = [this.sort()];
    while (this.accept(",")) sorts.push(this.sort());
    return sorts;
  }

  private sort(): Jql["orderBy"][number] {
    const token = this.next("a field name");
    const field = token.value.toLowerCase();
    if (!SORT_KEYS[field]) throw query(`Not able to sort using field '${token.value}'.`);
    if (this.acceptWord("desc")) return { field, desc: true };
    this.acceptWord("asc");
    return { field, desc: false };
  }

  private atEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  private peekWord(word: string): boolean {
    const token = this.tokens[this.index];
    return token?.kind === "word" && token.value.toLowerCase() === word;
  }

  private acceptWord(word: string): boolean {
    if (!this.peekWord(word)) return false;
    this.index++;
    return true;
  }

  private accept(punct: string): boolean {
    const token = this.tokens[this.index];
    if (token?.kind !== "punct" || token.value !== punct) return false;
    this.index++;
    return true;
  }

  private expect(punct: string): void {
    if (!this.accept(punct)) throw this.unexpected(`'${punct}'`);
  }

  private next(expected: string): Token {
    const token = this.tokens[this.index++];
    if (!token) throw query(`Expecting ${expected} but reached the end of the query.`);
    return token;
  }

  private unexpected(expected: string, hint = ""): JqlError {
    const token = this.tokens[this.index];
    if (!token) return query(`Expecting ${expected} but reached the end of the query.${hint}`);
    return query(
      `Expecting ${expected} but got '${token.value}'.${hint} (line 1, character ${token.at + 1})`,
    );
  }
}

function callFunction(name: string): Value {
  if (name.toLowerCase() === "currentuser") return { text: ME.accountId, empty: false };
  throw query(`Unable to find JQL function '${name}()'.`);
}

type Check = (own: string[], matches: boolean) => boolean;

const CHECKS: Record<string, Check> = {
  "=": (_own, matches) => matches,
  in: (_own, matches) => matches,
  // As on Jira, a negative clause never matches an issue whose field is EMPTY.
  "!=": (own, matches) => own.length > 0 && !matches,
  "not in": (own, matches) => own.length > 0 && !matches,
  is: (own) => own.length === 0,
  "is not": (own) => own.length > 0,
};

function compileClause(field: FieldDef, operator: string, values: Value[]): Predicate {
  const text = field.text;
  if (text) {
    const words = (values[0]?.text ?? "").toLowerCase().replace(/\*/g, "").split(/\s+/);
    const negate = operator === "!~";
    return (issue) => {
      const haystack = text(issue).toLowerCase();
      return words.every((word) => haystack.includes(word)) !== negate;
    };
  }
  if (operator.startsWith("is") && values.some((value) => !value.empty)) {
    throw query(`The operator '${operator.toUpperCase()}' can only be used with EMPTY or NULL.`);
  }
  checkKnown(field, values);
  const wanted = values.filter((value) => !value.empty).map((value) => value.text.toLowerCase());
  const wantsEmpty = values.some((value) => value.empty);
  const check = CHECKS[operator] as Check;
  const own = field.values ?? (() => []);
  return (issue) => {
    const mine = own(issue);
    const matches = mine.length === 0 ? wantsEmpty : wanted.some((value) => mine.includes(value));
    return check(mine, matches);
  };
}

function checkKnown(field: FieldDef, values: Value[]): void {
  const known = field.known?.();
  if (!known) return;
  const missing = values.find((value) => !value.empty && !known.includes(value.text.toLowerCase()));
  if (missing) {
    throw new JqlError(`The value '${missing.text}' does not exist for the field '${field.name}'.`);
  }
}

function compareBy(orderBy: Jql["orderBy"], a: IssueSpec, b: IssueSpec): number {
  for (const { field, desc } of orderBy) {
    const order = compareKeys(SORT_KEYS[field], a, b);
    if (order !== 0) return desc ? -order : order;
  }
  return 0;
}

function compareKeys(key: SortKey | undefined, a: IssueSpec, b: IssueSpec): number {
  const left = key?.(a) ?? 0;
  const right = key?.(b) ?? 0;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
