// File overview:
// - Purpose: Generic JSONB CRUD over multiple logical collections (users, posts, donations, rides, etc.) with Redis caching and activity tracking.
// - Reached from: `ItemsController` endpoints under '/api'.
// - Provides: create/read/update/delete/list with safe collection mapping; activity counters and cache stats via Redis.
// - Storage: Postgres tables named after collections with (user_id, item_id, data JSONB) + indexes.
// - Cache keys: item:{collection}:{userId}:{itemId}, list:{collection}:{userId}, activity:{userId}, daily_activity:{userId}:{YYYY-MM-DD}, popular_collections:*.
import { Inject, Injectable } from '@nestjs/common';
import { PG_POOL } from '../database/database.module';
import { Pool } from 'pg';
import { RedisCacheService } from '../redis/redis-cache.service';

@Injectable()
export class ItemsService {
  private readonly CACHE_TTL = 5 * 60; // 5 minutes

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly redisCache: RedisCacheService,
  ) {}

  private tableFor(collection: string): string {
    // map collection names to table names; default: use as-is
    const allowed = new Set([
      'users',
      'posts',
      'followers',
      'following',
      'chats',
      'messages',
      'notifications',
      'bookmarks',
      'donations',
      'tasks',
      'settings',
      'media',
      'blocked_users',
      'message_reactions',
      'typing_status',
      'read_receipts',
      'voice_messages',
      'conversation_metadata',
      'rides',
      // Organizations / NGO onboarding
      'organizations',
      'org_applications',
      // App analytics (e.g., category open counters)
      'analytics',
      // Stats
      'stats',
      'community_stats',
    ]);
    if (!allowed.has(collection)) {
      throw new Error(`Unknown collection: ${collection}`);
    }
    return collection;
  }

  async create(collection: string, userId: string, itemId: string, data: Record<string, unknown>) {
    const table = this.tableFor(collection);
    const client = await this.pool.connect();
    try {
      // Add activity tracking
      await this.trackUserActivity(userId, 'create', collection, itemId);
      
      await client.query(
        `INSERT INTO ${table} (user_id, item_id, data, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (user_id, item_id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [userId, itemId, data],
      );
      
      // Cache the created item
      const cacheKey = `item:${collection}:${userId}:${itemId}`;
      await this.redisCache.set(cacheKey, data, this.CACHE_TTL);
      
      // Invalidate list cache for this user and collection
      await this.invalidateListCache(collection, userId);
      
      // Track popular collections
      await this.incrementCollectionCounter(collection);
      
      return { ok: true };
    } finally {
      client.release();
    }
  }

  async read(collection: string, userId: string, itemId: string) {
    // Try cache first
    const cacheKey = `item:${collection}:${userId}:${itemId}`;
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      // Track cache hit
      await this.trackUserActivity(userId, 'read_cached', collection, itemId);
      return cached;
    }
    
    // Cache miss - get from database
    const table = this.tableFor(collection);
    const { rows } = await this.pool.query(
      `SELECT data FROM ${table} WHERE user_id = $1 AND item_id = $2 LIMIT 1`,
      [userId, itemId],
    );
    
    const data = rows[0]?.data ?? null;
    
    if (data) {
      // Cache the result
      await this.redisCache.set(cacheKey, data, this.CACHE_TTL);
      // Track cache miss
      await this.trackUserActivity(userId, 'read_db', collection, itemId);
    }
    
    return data;
  }

  async update(collection: string, userId: string, itemId: string, data: Record<string, unknown>) {
    const table = this.tableFor(collection);
    const { rowCount } = await this.pool.query(
      `UPDATE ${table} SET data = jsonb_strip_nulls(data || $1::jsonb), updated_at = NOW()
       WHERE user_id = $2 AND item_id = $3`,
      [data, userId, itemId],
    );
    return { ok: (rowCount ?? 0) > 0 };
  }

  async delete(collection: string, userId: string, itemId: string) {
    const table = this.tableFor(collection);
    const { rowCount } = await this.pool.query(
      `DELETE FROM ${table} WHERE user_id = $1 AND item_id = $2`,
      [userId, itemId],
    );
    return { ok: (rowCount ?? 0) > 0 };
  }

  async list(collection: string, userId: string, q?: string) {
    const table = this.tableFor(collection);
    if (q) {
      const { rows } = await this.pool.query(
        `SELECT data FROM ${table}
         WHERE user_id = $1 AND (data::text ILIKE $2)
         ORDER BY COALESCE((data->>'timestamp')::timestamptz, NOW()) DESC`,
        [userId, `%${q}%`],
      );
      return rows.map((r) => r.data);
    }
    const { rows } = await this.pool.query(
      `SELECT data FROM ${table}
       WHERE user_id = $1
       ORDER BY COALESCE((data->>'timestamp')::timestamptz, NOW()) DESC`,
      [userId],
    );
    return rows.map((r) => r.data);
  }

  // Redis Helper Functions
  
  private async trackUserActivity(userId: string, action: string, collection: string, itemId: string) {
    const activityKey = `activity:${userId}`;
    const activity = {
      action,
      collection,
      itemId,
      timestamp: new Date().toISOString(),
    };
    
    // Get recent activities (max 50)
    const recentActivities = await this.redisCache.get<any[]>(activityKey) || [];
    recentActivities.unshift(activity);
    
    // Keep only last 50 activities
    if (recentActivities.length > 50) {
      recentActivities.splice(50);
    }
    
    // Store with 1 hour TTL
    await this.redisCache.set(activityKey, recentActivities, 60 * 60);
    
    // Also increment daily activity counter
    const today = new Date().toISOString().split('T')[0];
    const dailyKey = `daily_activity:${userId}:${today}`;
    await this.redisCache.increment(dailyKey);
  }
  
  private async invalidateListCache(collection: string, userId: string) {
    const listCacheKey = `list:${collection}:${userId}`;
    await this.redisCache.delete(listCacheKey);
  }
  
  private async incrementCollectionCounter(collection: string) {
    const counterKey = `popular_collections:${collection}`;
    await this.redisCache.increment(counterKey);
  }

  // Public methods for Redis data access
  
  async getUserActivity(userId: string) {
    const activityKey = `activity:${userId}`;
    const activities = await this.redisCache.get<any[]>(activityKey) || [];
    
    const today = new Date().toISOString().split('T')[0];
    const dailyKey = `daily_activity:${userId}:${today}`;
    const dailyCount = await this.redisCache.get<number>(dailyKey) || 0;
    
    return {
      recentActivities: activities.slice(0, 10), // Last 10 activities
      totalActivities: activities.length,
      todayActivities: dailyCount,
      lastActivity: activities[0]?.timestamp || null,
    };
  }
  
  async getPopularCollections() {
    const keys = await this.redisCache.getKeys('popular_collections:*');
    const collections = [];
    
    for (const key of keys) {
      const collection = key.replace('popular_collections:', '');
      const count = await this.redisCache.get<number>(key) || 0;
      collections.push({ collection, count });
    }
    
    return collections.sort((a, b) => b.count - a.count);
  }
  
  async getCacheStats() {
    const itemKeys = await this.redisCache.getKeys('item:*');
    const listKeys = await this.redisCache.getKeys('list:*');
    const activityKeys = await this.redisCache.getKeys('activity:*');
    
    return {
      cachedItems: itemKeys.length,
      cachedLists: listKeys.length,
      userActivities: activityKeys.length,
      totalCacheEntries: itemKeys.length + listKeys.length + activityKeys.length,
    };
  }
}


