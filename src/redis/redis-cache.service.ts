// File overview:
// - Purpose: High-level Redis helper service for set/get/delete/exists/keys and counters.
// - Reached from: Injected into controllers/services for caching and stats.
// - Provides: JSON serialization, TTL, increment, info dump for debugging.
import { Injectable, Inject } from "@nestjs/common";
import Redis from "ioredis";
import { REDIS } from "./redis.module";

@Injectable()
export class RedisCacheService {
  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  /**
   * Check if Redis is available
   */
  private isRedisAvailable(): boolean {
    return this.redis !== null && this.redis.status === "ready";
  }

  /**
   * Store data in Redis with optional TTL (Time To Live)
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (!this.isRedisAvailable()) return;

    const serializedValue = JSON.stringify(value);

    if (ttlSeconds) {
      try {
        await this.redis!.setex(key, ttlSeconds, serializedValue);
      } catch (error) {
        console.warn(
          `[RedisCache] Failed to setex key ${key}:`,
          error instanceof Error ? error.message : error,
        );
      }
    } else {
      try {
        await this.redis!.set(key, serializedValue);
      } catch (error) {
        console.warn(
          `[RedisCache] Failed to set key ${key}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  /**
   * Get data from Redis
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    if (!this.isRedisAvailable()) return null;

    const value = await this.redis!.get(key);

    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch {
      // If parsing fails, return the raw string
      return value as T;
    }
  }

  /**
   * Delete a key from Redis
   */
  async delete(key: string): Promise<boolean> {
    if (!this.isRedisAvailable()) return false;
    try {
      const result = await this.redis!.del(key);
      return result > 0;
    } catch (error) {
      console.warn(
        `[RedisCache] Failed to delete key ${key}:`,
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.isRedisAvailable()) return false;
    const result = await this.redis!.exists(key);
    return result === 1;
  }

  /**
   * Get all keys matching a pattern
   */
  async getKeys(pattern: string = "*"): Promise<string[]> {
    if (!this.isRedisAvailable()) return [];
    return await this.redis!.keys(pattern);
  }

  async setWithExpiry(
    key: string,
    value: unknown,
    seconds: number,
  ): Promise<void> {
    return this.set(key, value, seconds);
  }

  /**
   * Increment a numeric value
   */
  async increment(key: string, amount: number = 1): Promise<number> {
    if (!this.isRedisAvailable()) return 0;
    try {
      if (amount === 1) {
        return await this.redis!.incr(key);
      } else {
        return await this.redis!.incrby(key, amount);
      }
    } catch (error) {
      console.warn(
        `[RedisCache] Failed to increment key ${key}:`,
        error instanceof Error ? error.message : error,
      );
      return 0;
    }
  }

  /**
   * Get Redis info for debugging
   */
  async getInfo(): Promise<any> {
    if (!this.isRedisAvailable()) {
      return {
        connected: false,
        keyCount: 0,
        info: "Redis not configured",
      };
    }

    const info = await this.redis!.info();
    const keyCount = await this.redis!.dbsize();

    return {
      connected: this.redis!.status === "ready",
      keyCount,
      info: info.split("\r\n").slice(0, 10).join("\n"), // First 10 lines
    };
  }

  /**
   * Set multiple keys at once using Redis pipeline for better performance
   * This is more efficient than calling set() multiple times as it batches operations
   *
   * @param entries Array of key-value pairs with optional TTL
   * @example
   * await redisCache.setMultiple([
   *   { key: 'user:1', value: userData, ttl: 600 },
   *   { key: 'user:2', value: userData2, ttl: 600 }
   * ]);
   */
  async setMultiple(
    entries: Array<{ key: string; value: unknown; ttl?: number }>,
  ): Promise<void> {
    if (!this.isRedisAvailable() || entries.length === 0) return;

    const pipeline = this.redis!.pipeline();

    for (const entry of entries) {
      const serializedValue = JSON.stringify(entry.value);
      if (entry.ttl) {
        pipeline.setex(entry.key, entry.ttl, serializedValue);
      } else {
        pipeline.set(entry.key, serializedValue);
      }
    }

    try {
      await pipeline.exec();
    } catch (error) {
      console.warn(
        `[RedisCache] Failed to setMultiple:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Get multiple keys at once using Redis pipeline for better performance
   * Returns a Map where keys are the cache keys and values are the cached data (or null if not found)
   *
   * @param keys Array of cache keys to retrieve
   * @returns Map of key -> value pairs (null if key doesn't exist)
   * @example
   * const results = await redisCache.getMultiple(['user:1', 'user:2', 'user:3']);
   * const user1 = results.get('user:1'); // User data or null
   */
  async getMultiple<T = unknown>(
    keys: string[],
  ): Promise<Map<string, T | null>> {
    if (!this.isRedisAvailable() || keys.length === 0) return new Map();

    const pipeline = this.redis!.pipeline();
    keys.forEach((key) => pipeline.get(key));

    const results = await pipeline.exec();
    const map = new Map<string, T | null>();

    if (results) {
      for (let i = 0; i < keys.length; i++) {
        const result = results[i];
        const key = keys[i];

        if (result && result[1] !== null) {
          try {
            map.set(key, JSON.parse(result[1] as string));
          } catch {
            // If parsing fails, return the raw string
            map.set(key, result[1] as T);
          }
        } else {
          map.set(key, null);
        }
      }
    }

    return map;
  }

  /**
   * Invalidate all keys matching a pattern efficiently using Redis pipeline
   * This is more efficient than manually getting keys and deleting them one by one
   *
   * @param pattern Redis key pattern (supports wildcards like 'user:*', 'stats_*')
   * @returns Number of keys deleted
   * @example
   * const deletedCount = await redisCache.invalidatePattern('user_stats_*');
   */
  async invalidatePattern(pattern: string): Promise<number> {
    if (!this.isRedisAvailable()) return 0;

    try {
      const keys = await this.getKeys(pattern);
      if (keys.length === 0) return 0;

      // Use pipeline for better performance
      const pipeline = this.redis!.pipeline();
      keys.forEach((key) => pipeline.del(key));
      await pipeline.exec();

      return keys.length;
    } catch (error) {
      // Log error but don't throw - cache clearing should not fail the operation
      console.warn(`Failed to invalidate cache pattern ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * Clear all statistics-related caches
   * This is used when user data changes (new user registered, etc.)
   * to ensure statistics are refreshed immediately
   */
  async clearStatsCaches(): Promise<void> {
    const patterns = [
      "community_stats_*",
      "community_trends_*",
      "city_stats_*",
      "dashboard_stats",
      "real_time_stats",
      "category_analytics",
      "user_analytics",
      "community_stats_version_*",
    ];

    for (const pattern of patterns) {
      await this.invalidatePattern(pattern);
    }
  }
}
