import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  /** Number = pixels; string is used verbatim (e.g. a percentage, for fluid `tableLayout="fixed"` tables). */
  width?: number | string;
}

/** Rows above this count use windowed rendering (~30 DOM nodes regardless of total). */
export const VIRTUAL_ROW_THRESHOLD = 50;
const ESTIMATED_ROW_HEIGHT = 44;

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

function TableRow<T>({
  row,
  columns,
  rowKey,
  rowClassName,
}: {
  row: T;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string;
}) {
  return (
    <tr key={rowKey(row)} className={rowClassName?.(row) ?? ''}>
      {columns.map((col) => (
        <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
          {col.render(row)}
        </td>
      ))}
    </tr>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  emptyState,
  initialSort,
  maxHeight = '65vh',
  virtualize = true,
  tableLayout = 'auto',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string;
  emptyState?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  maxHeight?: string;
  /** Window rows when count exceeds VIRTUAL_ROW_THRESHOLD (default true). */
  virtualize?: boolean;
  /**
   * 'fixed' locks column widths to the header row's `width`s so they never
   * recompute from whichever rows happen to be mounted. With virtualization,
   * the default 'auto' layout recalculates column widths from only the
   * currently-rendered (windowed) rows — as different rows scroll in/out,
   * that recalculation visibly jitters the table (and toggles the container's
   * horizontal scrollbar) even though nothing the user did should resize
   * anything. Opt in per-table (rather than switching every DataTable) since
   * it also requires the caller to give every column an explicit `width` for
   * sane proportions. Default 'auto' preserves prior behaviour everywhere else.
   */
  tableLayout?: 'auto' | 'fixed';
}) {
  const parentRef = useRef<HTMLDivElement>(null);
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

  const shouldVirtualize = virtualize && sortedRows.length > VIRTUAL_ROW_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? sortedRows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 12,
  });

  const virtualRows = shouldVirtualize ? rowVirtualizer.getVirtualItems() : [];

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
    <div
      ref={parentRef}
      data-testid="data-table-scroll"
      className="card overflow-auto overscroll-contain"
      style={{ maxHeight }}
    >
      <table
        className={`data-table${tableLayout === 'fixed' ? ' data-table-fixed' : ''}`}
        style={tableLayout === 'fixed' ? { tableLayout: 'fixed', width: '100%' } : undefined}
      >
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.sortable ? 'sortable' : ''}
                style={{
                  textAlign: col.align ?? 'left',
                  width: typeof col.width === 'number' ? `${col.width}px` : col.width,
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
          {shouldVirtualize ? (
            <>
              {virtualRows.length > 0 && virtualRows[0].start > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={columns.length}
                    style={{ height: virtualRows[0].start, padding: 0, border: 'none' }}
                  />
                </tr>
              )}
              {virtualRows.map((vi) => {
                const row = sortedRows[vi.index];
                return (
                  <TableRow
                    key={rowKey(row)}
                    row={row}
                    columns={columns}
                    rowKey={rowKey}
                    rowClassName={rowClassName}
                  />
                );
              })}
              {virtualRows.length > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={columns.length}
                    style={{
                      height: rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end,
                      padding: 0,
                      border: 'none',
                    }}
                  />
                </tr>
              )}
            </>
          ) : (
            sortedRows.map((row) => (
              <TableRow
                key={rowKey(row)}
                row={row}
                columns={columns}
                rowKey={rowKey}
                rowClassName={rowClassName}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
