import { useMemo } from "react";
import { parseCsv } from "./csv";

/** CSV or TSV as a table whose header stays in view; very long files show their first rows. */
export const CsvTable = ({ text }: { text: string }) => {
  const { columns, rows, omitted } = useMemo(() => keyed(parseCsv(text)), [text]);
  return (
    <div data-testid="artifact-csv" className="min-w-0 p-4">
      <div className="overflow-auto rounded-card border border-border">
        <table className="w-full border-collapse text-left text-meta">
          <thead className="sticky top-0 bg-raised">
            <tr>
              <th className="w-10 border-b border-border px-2 py-1.5 text-right font-normal text-text-subtle">
                #
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="whitespace-nowrap border-b border-border px-3 py-1.5 font-medium text-text"
                >
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="odd:bg-hover/40 hover:bg-hover">
                <td className="px-2 py-1 text-right tabular-nums text-text-subtle">{row.number}</td>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className="max-w-[28rem] truncate px-3 py-1 text-text-muted"
                    title={row.cells[column.index]}
                  >
                    {row.cells[column.index]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p data-testid="artifact-csv-summary" className="mt-2 text-meta text-text-subtle">
        {rows.length} {rows.length === 1 ? "row" : "rows"} · {columns.length}{" "}
        {columns.length === 1 ? "column" : "columns"}
        {omitted > 0 ? ` · ${omitted} more rows not shown; download the file for all of them` : ""}
      </p>
    </div>
  );
};

// Rows and columns are positional and never reorder, so their place is their key.
const keyed = ({ header, rows, omitted }: ReturnType<typeof parseCsv>) => ({
  columns: header.map((name, index) => ({ key: `c${index}`, index, name })),
  rows: rows.map((cells, index) => ({ key: `r${index}`, number: index + 1, cells })),
  omitted,
});
