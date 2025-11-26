#!/bin/bash
# File overview:
# - Purpose: Complete reset of ALL local data - Postgres, Redis, and ensures clean state
# - Usage: ./scripts/reset-all-local-data.sh
# - Warning: This will DELETE ALL DATA from local database

set -e

echo "🗑️  FULL Local Data Reset..."
echo "⚠️  WARNING: This will DELETE ALL DATA from local database!"
echo ""

# Step 1: Stop containers
echo "🛑 Stopping Docker containers..."
docker compose down

# Step 2: Remove volumes (complete wipe)
echo ""
echo "🗑️  Removing Docker volumes (complete wipe)..."
docker compose down -v

# Step 3: Start containers
echo ""
echo "🐳 Starting Docker containers..."
docker compose up -d

# Step 4: Wait for Postgres
echo ""
echo "⏳ Waiting for Postgres to be ready..."
sleep 5

MAX_ATTEMPTS=30
ATTEMPT=0
while ! docker compose exec -T postgres pg_isready -U kc > /dev/null 2>&1; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
    echo "❌ Postgres did not become ready in time"
    exit 1
  fi
  sleep 1
done

echo "✅ Postgres is ready"

# Step 5: Initialize database schema
echo ""
echo "📊 Initializing database schema..."
cd "$(dirname "$0")/.."
npm run reset:db

# Step 6: Delete ALL data from all tables
echo ""
echo "🗑️  Deleting ALL data from all tables..."
docker compose exec -T postgres psql -U kc -d kc_db <<'EOF'
-- Disable foreign key constraints temporarily
SET session_replication_role = replica;

-- Delete all data from all tables
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        ORDER BY tablename
    ) LOOP
        BEGIN
            EXECUTE 'DELETE FROM ' || quote_ident(r.tablename) || ' CASCADE';
            RAISE NOTICE 'Deleted all data from: %', r.tablename;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error deleting from %: %', r.tablename, SQLERRM;
        END;
    END LOOP;
END $$;

-- Re-enable foreign key constraints
SET session_replication_role = DEFAULT;

-- Reset all sequences to 1
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT sequence_name 
        FROM information_schema.sequences 
        WHERE sequence_schema = 'public'
    ) LOOP
        BEGIN
            EXECUTE 'ALTER SEQUENCE ' || quote_ident(r.sequence_name) || ' RESTART WITH 1';
            RAISE NOTICE 'Reset sequence: %', r.sequence_name;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error resetting sequence %: %', r.sequence_name, SQLERRM;
        END;
    END LOOP;
END $$;
EOF

# Step 7: Clear Redis
echo ""
echo "🗑️  Clearing Redis cache..."
docker compose exec -T redis redis-cli FLUSHALL

# Step 8: Verify everything is empty
echo ""
echo "🔍 Verifying all tables are empty..."
docker compose exec -T postgres psql -U kc -d kc_db <<'EOF'
SELECT 
    'users' as table_name, 
    (SELECT COUNT(*) FROM users) as count
UNION ALL
SELECT 'posts', (SELECT COUNT(*) FROM posts)
UNION ALL
SELECT 'chats', (SELECT COUNT(*) FROM chats)
UNION ALL
SELECT 'messages', (SELECT COUNT(*) FROM messages)
UNION ALL
SELECT 'user_profiles', (SELECT COUNT(*) FROM user_profiles)
UNION ALL
SELECT 'chat_conversations', (SELECT COUNT(*) FROM chat_conversations)
UNION ALL
SELECT 'chat_messages', (SELECT COUNT(*) FROM chat_messages)
UNION ALL
SELECT 'donations', (SELECT COUNT(*) FROM donations)
UNION ALL
SELECT 'organizations', (SELECT COUNT(*) FROM organizations)
UNION ALL
SELECT 'community_stats', (SELECT COUNT(*) FROM community_stats)
ORDER BY table_name;
EOF

echo ""
echo "✅ FULL Local Data Reset complete!"
echo "💡 All Docker volumes have been removed and recreated"
echo "💡 Database schema has been reinitialized"
echo "💡 All data has been deleted from all tables"
echo "💡 All sequences have been reset to 1"
echo "💡 Redis cache has been cleared"
echo ""
echo "⚠️  Note: If you still see data in the app, it might be from:"
echo "   - AsyncStorage in the mobile app (needs to be cleared from the app)"
echo "   - Production database on Railway (if app is connected to production)"
echo "   - Browser localStorage (if using web version)"

