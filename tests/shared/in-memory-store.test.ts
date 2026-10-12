import { InMemoryStore } from '../../src/shared/in-memory-store';

describe('InMemoryStore', () => {
  it('saves, reads, lists and removes items by id', () => {
    const store = new InMemoryStore<{ id: string; value: number }>();
    expect(store.get('a')).toBeNull();
    expect(store.all()).toEqual([]);

    expect(store.save({ id: 'a', value: 1 })).toEqual({ id: 'a', value: 1 });
    store.save({ id: 'b', value: 2 });
    expect(store.get('a')).toEqual({ id: 'a', value: 1 });
    expect(store.all()).toEqual([
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ]);

    store.save({ id: 'a', value: 10 });
    expect(store.get('a')).toEqual({ id: 'a', value: 10 });
    expect(store.all()).toHaveLength(2);

    expect(store.remove('a')).toBe(true);
    expect(store.remove('a')).toBe(false);
    expect(store.get('a')).toBeNull();
  });
});
