#!/bin/bash
# File overview:
# - Purpose: Quick script to reset local database (Postgres + Redis)
# - Usage: ./scripts/reset-db.sh
# - Warning: This will DELETE ALL DATA from local database

set -e

echo "🗑️  Resetting local database..."
echo ""

# Check if docker compose is running
if docker compose ps | grep -q "postgres"; then
  echo "📊 Clearing Postgres database via SQL..."
  docker compose exec -T postgres psql -U kc -d kc_db <<EOF
-- Disable foreign key constraints temporarily
SET session_replication_role = replica;

-- Get all table names and truncate them
DO \$\$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        RAISE NOTICE 'Cleared table: %', r.tablename;
    END LOOP;
END \$\$;

-- Re-enable foreign key constraints
SET session_replication_role = DEFAULT;

-- Reset all sequences
DO \$\$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') LOOP
        EXECUTE 'ALTER SEQUENCE ' || quote_ident(r.sequence_name) || ' RESTART WITH 1';
        RAISE NOTICE 'Reset sequence: %', r.sequence_name;
    END LOOP;
END \$\$;
EOF

  echo "✅ Postgres database cleared"
else
  echo "⚠️  Postgres container not running. Skipping..."
fi

# Clear Redis
if docker compose ps | grep -q "redis"; then
  echo ""
  echo "🗑️  Clearing Redis cache..."
  docker compose exec -T redis redis-cli FLUSHALL
  echo "✅ Redis cache cleared"
else
  echo "⚠️  Redis container not running. Skipping..."
fi

echo ""
echo "✅ Database reset complete!"
echo "💡 You may want to run 'npm run init:db' to recreate initial schema"

