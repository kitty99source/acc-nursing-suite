/** Shared page-size choices for long in-app tables. */
export const PAGE_SIZE_OPTIONS = [25, 50] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export interface PageSlice<T> {
  /** Rows for the current (clamped) page. */
  pageItems: T[];
  /** 1-based page index after clamping into `[1, pageCount]`. */
  page: number;
  pageCount: number;
  total: number;
  /** 1-based inclusive index of the first row on this page, or 0 when empty. */
  from: number;
  /** 1-based inclusive index of the last row on this page, or 0 when empty. */
  to: number;
}

/**
 * Slice `items` into a page. Pure and stable — empty lists yield page 1 / pageCount 1
 * with from/to 0 so footers can still render "0 of 0" without special-casing NaN.
 */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): PageSlice<T> {
  const total = items.length;
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(total / size) || 1);
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (safePage - 1) * size;
  const pageItems = items.slice(start, start + size);
  return {
    pageItems,
    page: safePage,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : Math.min(start + size, total),
  };
}
