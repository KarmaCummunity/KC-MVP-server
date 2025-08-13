import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from './database.module';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DatabaseInit implements OnModuleInit {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleInit() {
    try {
      const client = await this.pool.connect();
      try {
        // First, run the comprehensive schema
        await this.runSchema(client);
        
        // Keep backward compatibility with old JSONB tables
        await this.ensureBackwardCompatibility(client);

        // Initialize default data
        await this.initializeDefaultData(client);

        console.log('✅ DatabaseInit - Complete schema initialized successfully');
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('❌ DatabaseInit failed', err);
      throw err;
    }
  }

  private async runSchema(client: any) {
    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      
      // Split by semicolons and execute each statement
      const statements = schemaSql.split(';').filter(stmt => stmt.trim());
      
      for (const statement of statements) {
        if (statement.trim()) {
          await client.query(statement.trim());
        }
      }
      
      console.log('✅ Schema tables created successfully');
    } catch (err) {
      console.error('❌ Schema creation failed:', err);
      throw err;
    }
  }

  private async ensureBackwardCompatibility(client: any) {
    try {
      // Create old JSONB-based tables for backward compatibility
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

      const legacyTables = [
        'users', 'posts', 'followers', 'following', 'chats', 'messages', 'notifications', 'bookmarks',
        'donations', 'tasks', 'settings', 'media', 'blocked_users', 'message_reactions', 'typing_status',
        'read_receipts', 'voice_messages', 'conversation_metadata', 'rides', 'organizations', 'org_applications',
        'analytics'
      ];

      for (const t of legacyTables) {
        await client.query(baseTable(t));
      }

      await client.query(
        `CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users ((lower(data->>'email')));`
      );

      console.log('✅ Backward compatibility tables ensured');
    } catch (err) {
      console.error('❌ Backward compatibility setup failed:', err);
      throw err;
    }
  }

  private async initializeDefaultData(client: any) {
    try {
      // Initialize donation categories
      const categories = [
        { slug: 'money', name_he: 'כסף', name_en: 'Money', icon: '💰', color: '#4CAF50', sort_order: 1 },
        { slug: 'trump', name_he: 'טרמפים', name_en: 'Rides', icon: '🚗', color: '#2196F3', sort_order: 2 },
        { slug: 'knowledge', name_he: 'ידע', name_en: 'Knowledge', icon: '📚', color: '#9C27B0', sort_order: 3 },
        { slug: 'time', name_he: 'זמן', name_en: 'Time', icon: '⏰', color: '#FF9800', sort_order: 4 },
        { slug: 'food', name_he: 'אוכל', name_en: 'Food', icon: '🍞', color: '#8BC34A', sort_order: 5 },
        { slug: 'clothes', name_he: 'בגדים', name_en: 'Clothes', icon: '👕', color: '#03A9F4', sort_order: 6 },
        { slug: 'books', name_he: 'ספרים', name_en: 'Books', icon: '📖', color: '#607D8B', sort_order: 7 },
        { slug: 'furniture', name_he: 'רהיטים', name_en: 'Furniture', icon: '🪑', color: '#795548', sort_order: 8 },
        { slug: 'medical', name_he: 'רפואה', name_en: 'Medical', icon: '🏥', color: '#F44336', sort_order: 9 },
        { slug: 'animals', name_he: 'חיות', name_en: 'Animals', icon: '🐾', color: '#4CAF50', sort_order: 10 },
        { slug: 'housing', name_he: 'דיור', name_en: 'Housing', icon: '🏠', color: '#FF5722', sort_order: 11 },
        { slug: 'support', name_he: 'תמיכה', name_en: 'Support', icon: '💝', color: '#E91E63', sort_order: 12 },
        { slug: 'education', name_he: 'חינוך', name_en: 'Education', icon: '🎓', color: '#3F51B5', sort_order: 13 },
        { slug: 'environment', name_he: 'סביבה', name_en: 'Environment', icon: '🌱', color: '#4CAF50', sort_order: 14 },
        { slug: 'technology', name_he: 'טכנולוגיה', name_en: 'Technology', icon: '💻', color: '#009688', sort_order: 15 }
      ];

      for (const category of categories) {
        await client.query(`
          INSERT INTO donation_categories (slug, name_he, name_en, icon, color, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (slug) DO UPDATE SET
            name_he = EXCLUDED.name_he,
            name_en = EXCLUDED.name_en,
            icon = EXCLUDED.icon,
            color = EXCLUDED.color,
            sort_order = EXCLUDED.sort_order,
            updated_at = NOW()
        `, [category.slug, category.name_he, category.name_en, category.icon, category.color, category.sort_order]);
      }

      // Initialize global community stats
      const defaultStats = [
        { stat_type: 'money_donations', stat_value: 0 },
        { stat_type: 'volunteer_hours', stat_value: 0 },
        { stat_type: 'rides_completed', stat_value: 0 },
        { stat_type: 'events_created', stat_value: 0 },
        { stat_type: 'active_members', stat_value: 0 },
        { stat_type: 'food_kg', stat_value: 0 },
        { stat_type: 'clothing_kg', stat_value: 0 },
        { stat_type: 'books_donated', stat_value: 0 }
      ];

      for (const stat of defaultStats) {
        await client.query(`
          INSERT INTO community_stats (stat_type, stat_value, date_period)
          VALUES ($1, $2, CURRENT_DATE)
          ON CONFLICT (stat_type, city, date_period) DO NOTHING
        `, [stat.stat_type, stat.stat_value]);
      }

      console.log('✅ Default data initialized');
    } catch (err) {
      console.error('❌ Default data initialization failed:', err);
      // Don't throw here as it's not critical
    }
  }
}


