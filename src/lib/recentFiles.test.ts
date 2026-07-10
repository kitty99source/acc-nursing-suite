import { describe, expect, it } from 'vitest';
import { MAX_RECENT_FILES, removeRecentAt, upsertRecent } from './recentFiles';

interface Entry {
  name: string;
  lastUsedAt: number;
}

const mk = (name: string, lastUsedAt = 0): Entry => ({ name, lastUsedAt });

describe('upsertRecent', () => {
  it('adds a new entry at the front, most-recent-first', () => {
    const out = upsertRecent([mk('a')], mk('b', 1));
    expect(out.map((e) => e.name)).toEqual(['b', 'a']);
  });

  it('dedupes by name and moves the existing entry to the front (refreshing its data)', () => {
    const list = [mk('a', 1), mk('b', 2), mk('c', 3)];
    const out = upsertRecent(list, mk('b', 99));
    expect(out.map((e) => e.name)).toEqual(['b', 'a', 'c']);
    expect(out[0].lastUsedAt).toBe(99);
    // no duplicate "b"
    expect(out.filter((e) => e.name === 'b')).toHaveLength(1);
  });

  it('caps the list to MAX_RECENT_FILES, dropping the oldest', () => {
    let list: Entry[] = [];
    for (let i = 0; i < MAX_RECENT_FILES + 3; i++) {
      list = upsertRecent(list, mk(`f${i}`, i));
    }
    expect(list).toHaveLength(MAX_RECENT_FILES);
    // Most recent first; oldest ones fell off the end.
    expect(list[0].name).toBe(`f${MAX_RECENT_FILES + 2}`);
    expect(list.some((e) => e.name === 'f0')).toBe(false);
  });

  it('respects a custom cap', () => {
    const list = [mk('a'), mk('b')];
    const out = upsertRecent(list, mk('c'), 2);
    expect(out.map((e) => e.name)).toEqual(['c', 'a']);
  });

  it('does not mutate the input array', () => {
    const list = [mk('a')];
    const copy = [...list];
    upsertRecent(list, mk('b'));
    expect(list).toEqual(copy);
  });
});

describe('removeRecentAt', () => {
  it('removes the entry at the given index', () => {
    const out = removeRecentAt([mk('a'), mk('b'), mk('c')], 1);
    expect(out.map((e) => e.name)).toEqual(['a', 'c']);
  });

  it('is a no-op for an out-of-range index', () => {
    const list = [mk('a')];
    expect(removeRecentAt(list, 5).map((e) => e.name)).toEqual(['a']);
    expect(removeRecentAt(list, -1).map((e) => e.name)).toEqual(['a']);
  });
});
