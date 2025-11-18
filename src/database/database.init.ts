// File overview:
// - Purpose: Initialize database schema/tables on module init; supports modern schema and legacy JSONB compatibility.
// - Reached from: `AppModule` providers (runs on startup).
// - Provides: Detects legacy schema, runs `schema.sql` when available, ensures compatibility tables and default data.
// - Env inputs: `SKIP_FULL_SCHEMA` to skip full schema in dev.
// - Downstream: Creates core tables (community_stats, user_profiles, donation_categories, donations, user_activities) when needed.
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
        // 0) Allow forcing full schema via env var (overrides legacy detection and SKIP flags)
        const forceFullSchemaEnv = process.env.FORCE_FULL_SCHEMA;
        const forceFullSchema = !!forceFullSchemaEnv && /^(1|true|yes)$/i.test(forceFullSchemaEnv);

        if (forceFullSchema) {
          console.warn('⏭️  FORCE_FULL_SCHEMA detected. Running full schema initialization.');
          try {
            await this.runSchema(client);
            await this.initializeDefaultData(client);
            console.log('✅ DatabaseInit - Forced full schema initialized successfully');
          } catch (schemaError: unknown) {
            const reason = schemaError instanceof Error ? schemaError.message : String(schemaError);
            console.error('❌ Forced full schema initialization failed:', reason);
            throw schemaError;
          }
          return;
        }

        // 1) Detect legacy first – decide path
        const legacyDetected = await this.detectLegacySchema(client);

        if (legacyDetected) {
          console.warn('⏭️  Legacy JSONB schema detected. Initializing compatibility tables only.');
          await this.ensureBackwardCompatibility(client);
          await this.initializeDefaultData(client);
          console.log('✅ DatabaseInit - Legacy compatibility ensured');
          return;
        }

        // 2) For modern schema – optionally skip full schema in dev if requested
        if (process.env.SKIP_FULL_SCHEMA === '1') {
          console.warn('⏭️  Skipping full schema initialization (SKIP_FULL_SCHEMA=1)');
          await this.ensureBackwardCompatibility(client);
          await this.initializeDefaultData(client);
        } else {
          try {
            await this.runSchema(client);
            await this.initializeDefaultData(client);
            console.log('✅ DatabaseInit - Complete schema initialized successfully');
          } catch (schemaError: unknown) {
            const reason = schemaError instanceof Error ? schemaError.message : String(schemaError);
            console.warn('⚠️ Full schema initialization failed, attempting legacy compatibility only:', reason);
            await this.ensureBackwardCompatibility(client);
          }
        }
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('❌ DatabaseInit failed', err);
      throw err;
    }
  }

  private async detectLegacySchema(client: any): Promise<boolean> {
    try {
      const checks = [
        `SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'data'
          ) AS exists;`,
        `SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'donations' AND column_name = 'data'
          ) AS exists;`,
        `SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'chats' AND column_name = 'data'
          ) AS exists;`
      ];
      for (const sql of checks) {
        const res = await client.query(sql);
        if (res?.rows?.[0]?.exists) {
          return true;
        }
      }
      return false;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn('⚠️ Legacy schema detection failed, proceeding with full schema:', reason);
      return false;
    }
  }

  private async runSchema(client: any) {
    try {
      // Support both build (dist) and dev (src) paths
      const candidates = [
        path.join(__dirname, 'schema.sql'), // dist/database/schema.sql (build)
        path.join(process.cwd(), 'dist', 'database', 'schema.sql'),
        path.join(process.cwd(), 'src', 'database', 'schema.sql'), // dev path
        path.resolve(__dirname, '../../src/database/schema.sql'),
      ];

      let schemaPath = '';
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          schemaPath = p;
          break;
        }
      }

      if (!schemaPath) {
        throw new Error('schema.sql not found in expected locations');
      }

      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      
      // Split by semicolons and execute each statement
      const statements = schemaSql.split(';').filter(stmt => stmt.trim());
      
      for (const statement of statements) {
        if (statement.trim()) {
          await client.query(statement.trim());
        }
      }
      
      console.log(`✅ Schema tables created successfully from: ${schemaPath}`);
    } catch (err) {
      console.error('❌ Schema creation failed:', err);
      throw err;
    }
  }

  private async ensureBackwardCompatibility(client: any) {
    try {
      // Required extensions for UUIDs and text search
      await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

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

      // JSONB legacy tables for backward compatibility.
      // IMPORTANT: Exclude tables that are owned by the relational schema in schema.sql to avoid FK conflicts
      const relationalOwned = new Set([
        // core relational schema tables
        'user_profiles',
        'organizations', 'organization_applications',
        'donation_categories', 'donations',
        'rides', 'ride_bookings',
        'community_events', 'event_attendees',
        'chat_conversations', 'chat_messages', 'message_read_receipts',
        'user_activities', 'community_stats', 'user_follows', 'user_notifications',
      ]);

      const potentialLegacy = [
        'users', 'posts', 'followers', 'following', 'chats', 'messages', 'notifications', 'bookmarks',
        'donations', 'tasks', 'settings', 'media', 'blocked_users', 'message_reactions', 'typing_status',
        'read_receipts', 'voice_messages', 'conversation_metadata', 'rides', 'organizations', 'org_applications',
        'analytics'
      ];

      const legacyTables = potentialLegacy.filter(t => !relationalOwned.has(t));

      for (const t of legacyTables) {
        await client.query(baseTable(t));
      }

      await client.query(
        `CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users ((lower(data->>'email')));`
      );

      // Ensure minimal relational tables required by new controllers exist
      // community_stats is used by StatsController; create it even in legacy mode
      await client.query(`
        CREATE TABLE IF NOT EXISTS community_stats (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          stat_type VARCHAR(50) NOT NULL,
          stat_value BIGINT DEFAULT 0,
          city VARCHAR(100),
          date_period DATE,
          metadata JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(stat_type, city, date_period)
        );
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_community_stats_type ON community_stats (stat_type, date_period);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_community_stats_city ON community_stats (city, date_period);
      `);

      // Minimal user_profiles to satisfy joins and stats
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_profiles (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          phone VARCHAR(20),
          avatar_url TEXT,
          city VARCHAR(100),
          is_active BOOLEAN DEFAULT true,
          last_active TIMESTAMPTZ DEFAULT NOW(),
          join_date TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_user_profiles_email_lower ON user_profiles (LOWER(email));`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_user_profiles_city ON user_profiles (city);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_user_profiles_active ON user_profiles (is_active, last_active);`);

      // donation_categories to power categories and analytics
      await client.query(`
        CREATE TABLE IF NOT EXISTS donation_categories (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          slug VARCHAR(50) UNIQUE NOT NULL,
          name_he VARCHAR(100) NOT NULL,
          name_en VARCHAR(100) NOT NULL,
          description_he TEXT,
          description_en TEXT,
          icon VARCHAR(50),
          color VARCHAR(7),
          is_active BOOLEAN DEFAULT true,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // donations table with essential columns
      // If legacy JSONB 'donations' exists, replace it with relational schema
      const donationsLegacy = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'donations' AND column_name = 'data'
        ) AS exists;
      `);
      if (donationsLegacy?.rows?.[0]?.exists) {
        console.warn('⚠️  Replacing legacy JSONB donations table with relational schema');
        await client.query('DROP TABLE IF EXISTS donations CASCADE;');
      }
      await client.query(`
        CREATE TABLE IF NOT EXISTS donations (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          donor_id UUID,
          recipient_id UUID,
          organization_id UUID,
          category_id UUID,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          amount DECIMAL(10,2),
          currency VARCHAR(3) DEFAULT 'ILS',
          type VARCHAR(20) NOT NULL,
          status VARCHAR(20) DEFAULT 'active',
          is_recurring BOOLEAN DEFAULT false,
          location JSONB,
          images TEXT[],
          tags TEXT[],
          metadata JSONB,
          expires_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      // Create indexes conditionally to avoid errors if columns ever differ
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='donations' AND column_name='donor_id'
          ) THEN
            CREATE INDEX IF NOT EXISTS idx_donations_donor ON donations (donor_id);
          END IF;
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='donations' AND column_name='category_id'
          ) THEN
            CREATE INDEX IF NOT EXISTS idx_donations_category ON donations (category_id);
          END IF;
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='donations' AND column_name='type'
          ) THEN
            CREATE INDEX IF NOT EXISTS idx_donations_type ON donations (type);
          END IF;
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='donations' AND column_name='status'
          ) THEN
            CREATE INDEX IF NOT EXISTS idx_donations_status ON donations (status);
          END IF;
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='donations' AND column_name='created_at'
          ) THEN
            CREATE INDEX IF NOT EXISTS idx_donations_created ON donations (created_at);
          END IF;
        END$$;
      `);
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='donations' AND column_name='is_recurring'
          ) THEN
            ALTER TABLE donations ADD COLUMN is_recurring BOOLEAN DEFAULT false;
          END IF;
        END$$;
      `);
      // location is JSONB – safe
      await client.query(`CREATE INDEX IF NOT EXISTS idx_donations_location ON donations USING GIN (location);`);

      // minimal user_activities used by stats
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_activities (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID,
          activity_type VARCHAR(50) NOT NULL,
          activity_data JSONB,
          ip_address INET,
          user_agent TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // Ensure rides relational schema (replace legacy JSONB rides if exists)
      const ridesLegacy = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'rides' AND column_name = 'data'
        ) AS exists;
      `);
      if (ridesLegacy?.rows?.[0]?.exists) {
        console.warn('⚠️  Replacing legacy JSONB rides table with relational schema');
        await client.query('DROP TABLE IF EXISTS rides CASCADE;');
      }
      await client.query(`
        CREATE TABLE IF NOT EXISTS rides (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          driver_id UUID,
          title VARCHAR(255),
          from_location JSONB NOT NULL,
          to_location JSONB NOT NULL,
          departure_time TIMESTAMPTZ NOT NULL,
          arrival_time TIMESTAMPTZ,
          available_seats INTEGER DEFAULT 1,
          price_per_seat DECIMAL(10,2) DEFAULT 0,
          description TEXT,
          requirements TEXT,
          status VARCHAR(20) DEFAULT 'active',
          metadata JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='rides' AND column_name='driver_id'
          ) THEN
            CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides (driver_id);
          END IF;
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='rides' AND column_name='departure_time'
          ) THEN
            CREATE INDEX IF NOT EXISTS idx_rides_departure ON rides (departure_time);
          END IF;
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='rides' AND column_name='status'
          ) THEN
            CREATE INDEX IF NOT EXISTS idx_rides_status ON rides (status);
          END IF;
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='rides' AND column_name='created_at'
          ) THEN
            CREATE INDEX IF NOT EXISTS idx_rides_created ON rides (created_at);
          END IF;
        END$$;
      `);
      await client.query('CREATE INDEX IF NOT EXISTS idx_rides_from_location ON rides USING GIN (from_location);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_rides_to_location ON rides USING GIN (to_location);');

      // Minimal chat schema required by ChatController (compat mode)
      await client.query(`
        CREATE TABLE IF NOT EXISTS chat_conversations (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          title VARCHAR(255),
          type VARCHAR(20) DEFAULT 'direct',
          participants UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
          created_by UUID,
          last_message_id UUID,
          last_message_at TIMESTAMPTZ DEFAULT NOW(),
          metadata JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_conversations_participants ON chat_conversations USING GIN (participants);`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          conversation_id UUID,
          sender_id UUID,
          content TEXT,
          message_type VARCHAR(20) DEFAULT 'text',
          file_url TEXT,
          file_name VARCHAR(255),
          file_size INTEGER,
          file_type VARCHAR(100),
          metadata JSONB,
          reply_to_id UUID,
          is_edited BOOLEAN DEFAULT false,
          edited_at TIMESTAMPTZ,
          is_deleted BOOLEAN DEFAULT false,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages (conversation_id, created_at);`);

      // Add missing columns to existing chat_messages table if needed
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='chat_messages' AND column_name='is_deleted'
          ) THEN
            ALTER TABLE chat_messages ADD COLUMN is_deleted BOOLEAN DEFAULT false;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='chat_messages' AND column_name='deleted_at'
          ) THEN
            ALTER TABLE chat_messages ADD COLUMN deleted_at TIMESTAMPTZ;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='chat_messages' AND column_name='is_edited'
          ) THEN
            ALTER TABLE chat_messages ADD COLUMN is_edited BOOLEAN DEFAULT false;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='chat_messages' AND column_name='edited_at'
          ) THEN
            ALTER TABLE chat_messages ADD COLUMN edited_at TIMESTAMPTZ;
          END IF;
        END$$;
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS message_read_receipts (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          message_id UUID,
          user_id UUID,
          read_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(message_id, user_id)
        );
      `);

      // ride_bookings table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ride_bookings (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          ride_id UUID,
          passenger_id UUID,
          seats_requested INTEGER DEFAULT 1,
          status VARCHAR(20) DEFAULT 'pending',
          message TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(ride_id, passenger_id)
        );
      `);

      // community_events table - required by StatsController
      await client.query(`
        CREATE TABLE IF NOT EXISTS community_events (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          organizer_id UUID,
          organization_id UUID,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          event_date TIMESTAMPTZ NOT NULL,
          end_date TIMESTAMPTZ,
          location JSONB,
          max_attendees INTEGER,
          current_attendees INTEGER DEFAULT 0,
          category VARCHAR(50),
          tags TEXT[],
          image_url TEXT,
          is_virtual BOOLEAN DEFAULT false,
          meeting_link TEXT,
          status VARCHAR(20) DEFAULT 'active',
          metadata JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_community_events_date ON community_events (event_date);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_community_events_organizer ON community_events (organizer_id);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_community_events_status ON community_events (status);`);

      // event_attendees table
      await client.query(`
        CREATE TABLE IF NOT EXISTS event_attendees (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          event_id UUID,
          user_id UUID,
          status VARCHAR(20) DEFAULT 'going',
          registered_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(event_id, user_id)
        );
      `);

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

      // Create a test user for API testing
      await client.query(`
        INSERT INTO user_profiles (id, email, name, is_active)
        VALUES ('550e8400-e29b-41d4-a716-446655440000', 'test@example.com', 'Test User', true)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
      `);

      console.log('✅ Default data initialized');
    } catch (err) {
      console.error('❌ Default data initialization failed:', err);
      // Don't throw here as it's not critical
    }
  }
}


