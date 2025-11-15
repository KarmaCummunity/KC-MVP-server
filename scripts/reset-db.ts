// File overview:
// - Purpose: Reset local database - clears all tables and Redis cache
// - Usage: ts-node -r tsconfig-paths/register scripts/reset-db.ts
// - Warning: This will DELETE ALL DATA from local database

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import Redis from 'ioredis';

dotenv.config();

async function resetDatabase() {
  console.log('🗑️  Resetting local database...\n');

  // Connect to Postgres
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || 'kc',
    password: process.env.POSTGRES_PASSWORD || 'kc_password',
    database: process.env.POSTGRES_DB || 'kc_db',
  });

  const client = await pool.connect();
  
  try {
    console.log('📊 Clearing database tables...');
    
    // First, drop all foreign key constraints temporarily to avoid issues
    console.log('  Removing foreign key constraints temporarily...');
    const { rows: fks } = await client.query(`
      SELECT 
        conname AS constraint_name,
        conrelid::regclass AS table_name
      FROM pg_constraint
      WHERE contype = 'f'
      AND connamespace = 'public'::regnamespace
    `);
    
    for (const fk of fks) {
      try {
        await client.query(`ALTER TABLE ${fk.table_name} DROP CONSTRAINT IF EXISTS ${fk.constraint_name} CASCADE;`);
        console.log(`    ✓ Dropped constraint ${fk.constraint_name} from ${fk.table_name}`);
      } catch (error) {
        console.error(`    ✗ Error dropping constraint ${fk.constraint_name}:`, error instanceof Error ? error.message : String(error));
      }
    }
    
    // Get all table names
    const { rows: tables } = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    if (tables.length === 0) {
      console.log('✅ No tables found - database is empty');
    } else {
      console.log(`  Found ${tables.length} tables to clear...`);
      
      // Use DELETE instead of TRUNCATE for better compatibility
      // DELETE is slower but more reliable
      for (const table of tables) {
        try {
          // First try TRUNCATE (faster)
          await client.query(`TRUNCATE TABLE "${table.tablename}" RESTART IDENTITY CASCADE;`);
          console.log(`  ✓ Cleared ${table.tablename}`);
        } catch (error) {
          try {
            // Fallback to DELETE if TRUNCATE fails
            await client.query(`DELETE FROM "${table.tablename}";`);
            console.log(`  ✓ Cleared ${table.tablename} (using DELETE)`);
          } catch (deleteError) {
            console.error(`  ✗ Error clearing ${table.tablename}:`, deleteError instanceof Error ? deleteError.message : String(deleteError));
          }
        }
      }
      
      console.log(`\n✅ Cleared ${tables.length} tables`);
      
      // Note: Foreign key constraints were dropped, they will be recreated if schema is reinitialized
      console.log('  ⚠️  Note: Foreign key constraints were dropped and will need to be recreated');
    }

    // Reset sequences
    console.log('\n🔄 Resetting sequences...');
    const { rows: sequences } = await client.query(`
      SELECT sequence_name 
      FROM information_schema.sequences 
      WHERE sequence_schema = 'public'
    `);
    
    for (const seq of sequences) {
      try {
        await client.query(`ALTER SEQUENCE ${seq.sequence_name} RESTART WITH 1;`);
        console.log(`  ✓ Reset ${seq.sequence_name}`);
      } catch (error) {
        console.error(`  ✗ Error resetting ${seq.sequence_name}:`, error instanceof Error ? error.message : String(error));
      }
    }

  } catch (error) {
    console.error('❌ Error resetting database:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  // Clear Redis cache
  console.log('\n🗑️  Clearing Redis cache...');
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redisClient = new Redis(redisUrl);
  
  try {
    await redisClient.flushall();
    console.log('✅ Redis cache cleared');
    await redisClient.quit();
  } catch (error) {
    console.error('⚠️  Error clearing Redis (might not be running):', error instanceof Error ? error.message : String(error));
    // Don't throw - Redis might not be running
    try {
      await redisClient.quit();
    } catch {}
  }

  console.log('\n✅ Database reset complete!');
  console.log('💡 You may want to run "npm run init:db" to recreate initial schema');
}

// Run the reset
resetDatabase()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed to reset database:', error);
    process.exit(1);
  });

