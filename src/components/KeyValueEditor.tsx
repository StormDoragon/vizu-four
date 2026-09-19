"use client";

export interface KeyValueRow {
  key: string;
  value: string;
}

export function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.key.trim()) out[r.key.trim()] = r.value;
  return out;
}

export function KeyValueEditor({
  testId,
  title,
  rows,
  setRows,
}: {
  testId: string;
  title: string;
  rows: KeyValueRow[];
  setRows: (r: KeyValueRow[]) => void;
}) {
  return (
    <div data-testid={`kv-section-${testId}`}>
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">{title}</h4>
        <button
          onClick={() => setRows([...rows, { key: "", value: "" }])}
          data-testid={`kv-add-${testId}`}
          className="text-xs text-status-running hover:underline"
        >
          + add
        </button>
      </div>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-1">
            <input
              value={row.key}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
              placeholder="KEY"
              data-testid={`kv-${testId}-key-${i}`}
              className="w-1/3 rounded border border-bg-border bg-bg-panel px-2 py-1 text-xs text-ink-100 focus:border-status-running focus:outline-none"
            />
            <input
              value={row.value}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
              placeholder="value"
              data-testid={`kv-${testId}-value-${i}`}
              className="flex-1 rounded border border-bg-border bg-bg-panel px-2 py-1 text-xs text-ink-100 focus:border-status-running focus:outline-none"
            />
            <button
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              className="px-1 text-xs text-ink-500 hover:text-red-400"
            >
              ✕
            </button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs italic text-ink-600">none</p>}
      </div>
    </div>
  );
}
