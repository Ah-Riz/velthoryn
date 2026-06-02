import { Redis } from "@upstash/redis";

type RedisLike = Pick<Redis, "get" | "set" | "del" | "getdel">;

class MemoryRedis implements RedisLike {
  private store = new Map<string, { value: string; expiresAt: number }>();

  clear(): void {
    this.store.clear();
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt > 0 && entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    this.purgeExpired();
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt > 0 && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: any, options?: any): Promise<any> {
    const expiresAt =
      options?.ex !== undefined ? Date.now() + options.ex * 1000 : 0;
    this.store.set(key, { value, expiresAt });
    return "OK";
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async getdel<T>(key: string): Promise<T | null> {
    this.purgeExpired();
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt > 0 && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    this.store.delete(key);
    return entry.value as T;
  }
}

let client: RedisLike | null = null;

export function hasUpstashRedis(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

export function getRedis(): RedisLike {
  if (client) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (hasUpstashRedis()) {
    client = new Redis({
      url: url!,
      token: token!,
    });
  } else {
    client = new MemoryRedis();
  }

  return client;
}

export function resetRedisForTests(): void {
  if (client instanceof MemoryRedis) {
    client.clear();
  }
  client = null;
}
