/** Tiny in-process TTL cache so repeated reads in one page load do not re-hit the database. */
export class TtlCache<T> {
  private readonly store = new Map<string, { at: number; value: T }>();

  constructor(private readonly ttlMs: number, private readonly max = 200) {}

  get(key: string): T | undefined {
    const row = this.store.get(key);
    if (!row) return undefined;
    if (Date.now() - row.at > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return row.value;
  }

  set(key: string, value: T): T {
    if (this.store.size >= this.max) {
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    this.store.set(key, { at: Date.now(), value });
    return value;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  async remember(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    return this.set(key, await load());
  }
}
