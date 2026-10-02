/** The most rows the table draws; a larger file says how many it left out. */
export const CSV_MAX_ROWS = 5_000;

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  /** Rows past `CSV_MAX_ROWS`, not drawn. */
  omitted: number;
}

/**
 * RFC 4180: fields split by the delimiter, quoted fields may hold delimiters, newlines and
 * doubled quotes. The delimiter is a tab when the first line has more tabs than commas (a TSV),
 * else a comma; a file with neither but semicolons is read with semicolons.
 */
export const parseCsv = (text: string, maxRows = CSV_MAX_ROWS): ParsedCsv => {
  const records = readRecords(text.replace(/^﻿/, ""), delimiterOf(text));
  const [header = [], ...rows] = records;
  const width = Math.max(header.length, ...rows.map((row) => row.length));
  const padded = (row: string[]) => [...row, ...Array<string>(width - row.length).fill("")];
  return {
    header: padded(header),
    rows: rows.slice(0, maxRows).map(padded),
    omitted: Math.max(0, rows.length - maxRows),
  };
};

const delimiterOf = (text: string): string => {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (char: string) => first.split(char).length - 1;
  if (count("\t") > count(",")) return "\t";
  if (count(",") === 0 && count(";") > 0) return ";";
  return ",";
};

interface Reader {
  records: string[][];
  record: string[];
  field: string;
  quoted: boolean;
}

const readRecords = (text: string, delimiter: string): string[][] => {
  const reader: Reader = { records: [], record: [], field: "", quoted: false };
  for (let index = 0; index < text.length; index++) {
    index += reader.quoted
      ? readQuoted(reader, text, index)
      : readPlain(reader, text, index, delimiter);
  }
  if (reader.field !== "" || reader.record.length > 0) endRecord(reader);
  return reader.records.filter((row) => !(row.length === 1 && row[0] === ""));
};

// Each returns how many characters past `index` it also consumed.
const readQuoted = (reader: Reader, text: string, index: number): number => {
  const char = text.charAt(index);
  if (char !== '"') reader.field += char;
  else if (text.charAt(index + 1) === '"') {
    reader.field += '"';
    return 1;
  } else reader.quoted = false;
  return 0;
};

const readPlain = (reader: Reader, text: string, index: number, delimiter: string): number => {
  const char = text.charAt(index);
  if (char === '"' && reader.field === "") reader.quoted = true;
  else if (char === delimiter) endField(reader);
  else if (char === "\n" || char === "\r") {
    endRecord(reader);
    return char === "\r" && text.charAt(index + 1) === "\n" ? 1 : 0;
  } else reader.field += char;
  return 0;
};

const endField = (reader: Reader): void => {
  reader.record.push(reader.field);
  reader.field = "";
};

const endRecord = (reader: Reader): void => {
  endField(reader);
  reader.records.push(reader.record);
  reader.record = [];
};
