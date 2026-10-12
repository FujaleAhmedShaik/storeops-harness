/** Generic id-keyed store backing the in-memory repositories (the capstone needs no database). */
export class InMemoryStore<T extends { readonly id: string }> {
  private readonly items = new Map<string, T>();

  get(id: string): T | null {
    return this.items.get(id) ?? null;
  }

  save(item: T): T {
    this.items.set(item.id, item);
    return item;
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  all(): T[] {
    return [...this.items.values()];
  }
}
