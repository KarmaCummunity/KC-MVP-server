import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from './database.module';

@Injectable()
export class DatabaseInit implements OnModuleInit {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleInit() {
    try {
      const client = await this.pool.connect();
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

        const baseTable = (name: string) => `
          CREATE TABLE IF NOT EXISTS ${name} (
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, item_id)
          );
          CREATE INDEX IF NOT EXISTS ${name}_user_idx ON ${name}(user_id);
          CREATE INDEX IF NOT EXISTS ${name}_item_idx ON ${name}(item_id);
          CREATE INDEX IF NOT EXISTS ${name}_data_gin ON ${name} USING GIN (data);
        `;

        const tables = [
          'users', 'posts', 'followers', 'following', 'chats', 'messages', 'notifications', 'bookmarks',
          'donations', 'tasks', 'settings', 'media', 'blocked_users', 'message_reactions', 'typing_status',
          'read_receipts', 'voice_messages', 'conversation_metadata', 'rides', 'organizations', 'org_applications',
          // App analytics (e.g., category open counters)
          'analytics'
        ];

        for (const t of tables) {
          await client.query(baseTable(t));
        }

        await client.query(
          `CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users ((lower(data->>'email')));`
        );
        // eslint-disable-next-line no-console
        console.log('✅ DatabaseInit - ensured base tables and email index');
      } finally {
        client.release();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('❌ DatabaseInit failed', err);
    }
  }
}


