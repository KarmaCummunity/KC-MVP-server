import { Inject, Injectable } from '@nestjs/common';
import { PG_POOL } from '../database/database.module';
import { Pool } from 'pg';

@Injectable()
export class ItemsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

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
      await client.query(
        `INSERT INTO ${table} (user_id, item_id, data, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (user_id, item_id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [userId, itemId, data],
      );
      return { ok: true };
    } finally {
      client.release();
    }
  }

  async read(collection: string, userId: string, itemId: string) {
    const table = this.tableFor(collection);
    const { rows } = await this.pool.query(
      `SELECT data FROM ${table} WHERE user_id = $1 AND item_id = $2 LIMIT 1`,
      [userId, itemId],
    );
    return rows[0]?.data ?? null;
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
}


