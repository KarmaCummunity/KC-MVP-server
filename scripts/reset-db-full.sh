#!/bin/bash
# File overview:
# - Purpose: Complete reset - drops Docker volumes and recreates everything
# - Usage: ./scripts/reset-db-full.sh
# - Warning: This will DELETE ALL DATA including Docker volumes

set -e

echo "🗑️  FULL Database Reset (including Docker volumes)..."
echo "⚠️  WARNING: This will DELETE ALL DATA including Docker volumes!"
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "❌ Cancelled"
  exit 1
fi

echo ""
echo "🛑 Stopping Docker containers..."
docker compose down

echo ""
echo "🗑️  Removing Docker volumes..."
docker compose down -v

echo ""
echo "🐳 Starting Docker containers..."
docker compose up -d

echo ""
echo "⏳ Waiting for Postgres to be ready..."
sleep 5

# Wait for Postgres to be ready
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

echo ""
echo "📊 Initializing database schema..."
cd "$(dirname "$0")/.."
npm run init:db

echo ""
echo "🗑️  Clearing Redis cache..."
docker compose exec -T redis redis-cli FLUSHALL

echo ""
echo "✅ FULL Database reset complete!"
echo "💡 All Docker volumes have been removed and recreated"
echo "💡 Database schema has been reinitialized"

