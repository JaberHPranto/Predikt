interface CacheEntry<V> {
  value: V;
  expiresAt: number | null;
  groupKey: string | null;
  lastAccessed: number;
  accessCount: number;
}

export class BoundedCache<V> {
  private cache: Map<string, CacheEntry<V>> = new Map();
  private groupIndex: Map<string, Set<string>> = new Map();

  constructor(private readonly maxSize: number) {
    if (maxSize < 1) {
      throw new Error("Max size must be greater than 0");
    }
  }

  get(key: string): V | undefined {
    const entry = this.cache.get(key);
    const now = Date.now();

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt !== null && entry.expiresAt < now) {
      this.deleteEntry(key, entry);
      return undefined;
    }

    entry.lastAccessed = now;
    entry.accessCount++;

    return entry.value;
  }

  set(
    key: string,
    value: V,
    options?: {
      ttlMs?: number | null;
      groupKey?: string | null;
    },
  ): void {
    const existing = this.cache.get(key);
    if (existing) {
      this.deleteEntry(key, existing);
    }

    while (this.cache.size >= this.maxSize) {
      this.evictLeastRecentlyUsed();
    }

    const now = Date.now();
    const ttlMs = options?.ttlMs ?? null;
    const groupKey = options?.groupKey ?? null;

    const cacheEntry: CacheEntry<V> = {
      value,
      groupKey,
      expiresAt: ttlMs !== null ? now + ttlMs : null,
      lastAccessed: Date.now(),
      accessCount: 1,
    };

    this.cache.set(key, cacheEntry);

    if (groupKey) {
      let keys = this.groupIndex.get(groupKey);
      if (!keys) {
        keys = new Set();
        this.groupIndex.set(groupKey, keys);
      }
      keys.add(key);
    }
  }

  invalidateGroup(groupKey: string): number {
    const keys = this.groupIndex.get(groupKey);
    let count = 0;

    if (!keys) {
      return 0;
    }

    for (const key of keys) {
      const entry = this.cache.get(key);
      if (entry) {
        this.deleteEntry(key, entry);
        count++;
      }
    }

    return count;
  }

  private evictLeastRecentlyUsed(): void {
    const now = Date.now();
    let lowestScore = Infinity;
    let evictCandidateKey: string | null = null;

    for (const [key, entry] of this.cache) {
      // check for expiration
      if (entry.expiresAt !== null && entry.expiresAt < now) {
        this.deleteEntry(key, entry);
        return;
      }

      // calculate least recent used
      const ageInSeconds = Math.max(1, (now - entry.lastAccessed) / 1000);
      const score = entry.accessCount / ageInSeconds;

      if (score < lowestScore) {
        lowestScore = score;
        evictCandidateKey = key;
      }
    }

    if (evictCandidateKey) {
      const entry = this.cache.get(evictCandidateKey);
      if (entry) {
        this.deleteEntry(evictCandidateKey, entry);
      }
    }
  }

  private deleteEntry(key: string, entry: CacheEntry<V>): void {
    this.cache.delete(key);

    if (entry.groupKey) {
      const keys = this.groupIndex.get(entry.groupKey);
      if (keys) {
        keys.delete(key);
        if (keys.size === 0) {
          this.groupIndex.delete(entry.groupKey);
        }
      }
    }
  }

  clear(): void {
    this.cache.clear();
    this.groupIndex.clear();
  }
}

export function buildCacheKey(...parts: Array<string | number>): string {
  // example: "s5:Hello|n3:456"
  let key = "";

  for (const part of parts) {
    const typePrefix = typeof part === "string" ? "s" : "n";
    const value = String(part);

    key += `${typePrefix}${value.length}:${value}|`;
  }

  return key;
}
