import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: number;
}

/**
 * Build dynamic table columns for the union of `customFields` keys present
 * across the given rows (imported from Excel). Returns [] when there are none,
 * so tables look exactly as before when nothing custom has been imported.
 */
export function customColumns<T>(
  rows: T[],
  getCustom: (row: T) => Record<string, string> | undefined,
): Column<T>[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const cf = getCustom(row);
    if (!cf) continue;
    for (const k of Object.keys(cf)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys.map((k) => ({
    key: `custom:${k}`,
    header: k,
    render: (row: T) => getCustom(row)?.[k] ?? '—',
  }));
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  emptyState,
  initialSort,
  maxHeight = '65vh',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string;
  emptyState?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  maxHeight?: string;
}) {
  const [sortKey, setSortKey] = useState<string | undefined>(initialSort?.key);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSort?.dir ?? 'asc');

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const getVal = col.sortValue;
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);
      let cmp: number;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, columns, sortKey, sortDir]);

  function toggleSort(key: string) {
    const col = columns.find((c) => c.key === key);
    if (!col?.sortable) return;
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="card overflow-auto" style={{ maxHeight }}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.sortable ? 'sortable' : ''}
                style={{
                  textAlign: col.align ?? 'left',
                  width: col.width ? `${col.width}px` : undefined,
                }}
                onClick={() => toggleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === col.key && (
                    <span aria-hidden>{sortDir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={rowKey(row)} className={rowClassName?.(row) ?? ''}>
              {columns.map((col) => (
                <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
