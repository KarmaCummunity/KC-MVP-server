// File overview:
// - Purpose: High-level Redis helper service for set/get/delete/exists/keys and counters.
// - Reached from: Injected into controllers/services for caching and stats.
// - Provides: JSON serialization, TTL, increment, info dump for debugging.
import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from './redis.module';

@Injectable()
export class RedisCacheService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Store data in Redis with optional TTL (Time To Live)
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serializedValue = JSON.stringify(value);
    
    if (ttlSeconds) {
      await this.redis.setex(key, ttlSeconds, serializedValue);
    } else {
      await this.redis.set(key, serializedValue);
    }
  }

  /**
   * Get data from Redis
   */
  async get<T = any>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      // If parsing fails, return the raw string
      return value as T;
    }
  }

  /**
   * Delete a key from Redis
   */
  async delete(key: string): Promise<boolean> {
    const result = await this.redis.del(key);
    return result > 0;
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  /**
   * Get all keys matching a pattern
   */
  async getKeys(pattern: string = '*'): Promise<string[]> {
    return await this.redis.keys(pattern);
  }

  /**
   * Set with expiration (alias for set with TTL)
   */
  async setWithExpiry(key: string, value: any, seconds: number): Promise<void> {
    return this.set(key, value, seconds);
  }

  /**
   * Increment a numeric value
   */
  async increment(key: string, amount: number = 1): Promise<number> {
    if (amount === 1) {
      return await this.redis.incr(key);
    } else {
      return await this.redis.incrby(key, amount);
    }
  }

  /**
   * Get Redis info for debugging
   */
  async getInfo(): Promise<any> {
    const info = await this.redis.info();
    const keyCount = await this.redis.dbsize();
    
    return {
      connected: this.redis.status === 'ready',
      keyCount,
      info: info.split('\r\n').slice(0, 10).join('\n'), // First 10 lines
    };
  }
}
