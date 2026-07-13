import { describe, expect, it } from 'vitest';
import { paginate } from './listPagination';

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5, 6, 7];

  it('returns the first page by default', () => {
    expect(paginate(items, 1, 3)).toEqual({
      pageItems: [1, 2, 3],
      page: 1,
      pageCount: 3,
      total: 7,
      from: 1,
      to: 3,
    });
  });

  it('returns a middle and last page', () => {
    expect(paginate(items, 2, 3).pageItems).toEqual([4, 5, 6]);
    expect(paginate(items, 3, 3)).toMatchObject({
      pageItems: [7],
      page: 3,
      from: 7,
      to: 7,
    });
  });

  it('clamps page below 1 and above pageCount', () => {
    expect(paginate(items, 0, 3).page).toBe(1);
    expect(paginate(items, 99, 3).page).toBe(3);
    expect(paginate(items, 99, 3).pageItems).toEqual([7]);
  });

  it('handles an empty list without NaN indices', () => {
    expect(paginate([], 1, 25)).toEqual({
      pageItems: [],
      page: 1,
      pageCount: 1,
      total: 0,
      from: 0,
      to: 0,
    });
  });
});
