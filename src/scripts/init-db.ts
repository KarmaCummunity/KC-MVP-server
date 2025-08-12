import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function run() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || 'kc',
    password: process.env.POSTGRES_PASSWORD || 'kc_password',
    database: process.env.POSTGRES_DB || 'kc_db',
  });

  const client = await pool.connect();
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
    ];

    for (const t of tables) {
      // eslint-disable-next-line no-console
      console.log(`Ensuring table: ${t}`);
      await client.query(baseTable(t));
    }

    // Index for email lookup in users table
    await client.query(
      `CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users ((lower(data->>'email')))`
    );

    // eslint-disable-next-line no-console
    console.log('✅ Database initialized');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ init-db failed', err);
  process.exit(1);
});


