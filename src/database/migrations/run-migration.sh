#!/bin/bash
# Migration Runner Script
# Purpose: Run Firebase UID migration safely in any environment
# Usage: ./run-migration.sh [dev|prod]

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATION_FILE="$SCRIPT_DIR/migrate-to-firebase-uid.sql"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Environment detection
ENVIRONMENT="${1:-dev}"

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}🚀 Firebase UID Migration Script${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "Environment: ${YELLOW}$ENVIRONMENT${NC}"
echo ""

# Database connection settings based on environment
if [ "$ENVIRONMENT" = "prod" ]; then
    echo -e "${RED}⚠️  WARNING: Running in PRODUCTION mode!${NC}"
    read -p "Are you sure you want to continue? (type 'yes' to proceed): " confirmation
    if [ "$confirmation" != "yes" ]; then
        echo -e "${RED}Migration cancelled.${NC}"
        exit 1
    fi
    
    # Production settings (from environment variables)
    DB_HOST="${POSTGRES_HOST:-localhost}"
    DB_PORT="${POSTGRES_PORT:-5432}"
    DB_USER="${POSTGRES_USER:-kc}"
    DB_PASSWORD="${POSTGRES_PASSWORD:-kc_password}"
    DB_NAME="${POSTGRES_DB:-kc_db}"
    CONTAINER_NAME=""  # Don't use container in production
else
    # Development settings (Docker)
    DB_HOST="localhost"
    DB_PORT="5432"
    DB_USER="kc"
    DB_PASSWORD="kc_password"
    DB_NAME="kc_db"
    CONTAINER_NAME="kc-mvp-server-postgres-1"
fi

# Function to run SQL in container or directly
run_sql() {
    local sql_file="$1"
    
    if [ -n "$CONTAINER_NAME" ]; then
        # Development: Use Docker container
        echo -e "${BLUE}Running migration via Docker container: $CONTAINER_NAME${NC}"
        
        # Check if container exists and is running
        if ! docker ps | grep -q "$CONTAINER_NAME"; then
            echo -e "${RED}Error: Container $CONTAINER_NAME is not running!${NC}"
            exit 1
        fi
        
        docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" < "$sql_file"
    else
        # Production: Use psql directly
        echo -e "${BLUE}Running migration via psql${NC}"
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "$sql_file"
    fi
}

# Function to create backup
create_backup() {
    local backup_dir="$SCRIPT_DIR/../../backups"
    mkdir -p "$backup_dir"
    
    local backup_file="$backup_dir/backup_before_migration_${ENVIRONMENT}_$(date +%Y%m%d_%H%M%S).sql"
    
    echo -e "${BLUE}📦 Creating backup...${NC}"
    
    if [ -n "$CONTAINER_NAME" ]; then
        docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" "$DB_NAME" > "$backup_file"
    else
        PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" > "$backup_file"
    fi
    
    if [ -f "$backup_file" ]; then
        local backup_size=$(du -h "$backup_file" | cut -f1)
        echo -e "${GREEN}✅ Backup created: $backup_file ($backup_size)${NC}"
        echo "$backup_file"
    else
        echo -e "${RED}❌ Failed to create backup!${NC}"
        exit 1
    fi
}

# Function to verify database connection
verify_connection() {
    echo -e "${BLUE}🔌 Verifying database connection...${NC}"
    
    if [ -n "$CONTAINER_NAME" ]; then
        if docker exec "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Database connection successful${NC}"
            return 0
        fi
    else
        if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Database connection successful${NC}"
            return 0
        fi
    fi
    
    echo -e "${RED}❌ Failed to connect to database!${NC}"
    exit 1
}

# Function to check current schema
check_schema() {
    echo -e "${BLUE}📊 Checking current schema...${NC}"
    
    local check_query="
    SELECT 
        CASE 
            WHEN EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'user_profiles' 
                AND column_name = 'firebase_uid'
                AND is_identity = 'NO'
                AND column_default IS NULL
            ) THEN 'Already migrated (firebase_uid is PK)'
            WHEN EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'user_profiles' 
                AND column_name = 'id'
            ) THEN 'Not migrated (UUID PK)'
            ELSE 'Unknown state'
        END as migration_status;
    "
    
    if [ -n "$CONTAINER_NAME" ]; then
        local status=$(docker exec "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -t -c "$check_query" | xargs)
    else
        local status=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "$check_query" | xargs)
    fi
    
    echo -e "Current status: ${YELLOW}$status${NC}"
    
    if [[ "$status" == *"Already migrated"* ]]; then
        echo -e "${YELLOW}⚠️  Database appears to be already migrated.${NC}"
        read -p "Do you want to continue anyway? (y/n): " continue_anyway
        if [ "$continue_anyway" != "y" ]; then
            echo -e "${YELLOW}Migration cancelled.${NC}"
            exit 0
        fi
    fi
}

# Main execution
main() {
    echo ""
    
    # Step 1: Verify connection
    verify_connection
    echo ""
    
    # Step 2: Check current schema
    check_schema
    echo ""
    
    # Step 3: Create backup
    BACKUP_FILE=$(create_backup)
    echo ""
    
    # Step 4: Run migration
    echo -e "${BLUE}🔄 Running migration...${NC}"
    echo -e "${YELLOW}This may take a few minutes depending on data size...${NC}"
    echo ""
    
    if run_sql "$MIGRATION_FILE"; then
        echo ""
        echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}✅ Migration completed successfully!${NC}"
        echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
        echo ""
        echo -e "Backup file: ${BLUE}$BACKUP_FILE${NC}"
        echo ""
        echo -e "${YELLOW}Next steps:${NC}"
        echo "1. Test the application thoroughly"
        echo "2. Update server code to use firebase_uid"
        echo "3. Update client code if needed"
        echo ""
        
        # Show summary
        echo -e "${BLUE}📊 Migration Summary:${NC}"
        if [ -n "$CONTAINER_NAME" ]; then
            docker exec "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -c "
                SELECT 
                    (SELECT COUNT(*) FROM user_profiles) as total_users,
                    (SELECT COUNT(*) FROM user_profiles WHERE firebase_uid LIKE 'temp_%') as temp_uids,
                    (SELECT COUNT(*) FROM donations WHERE donor_id IS NOT NULL) as donations_with_donors,
                    (SELECT COUNT(*) FROM chat_messages) as total_messages;
            "
        else
            PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
                SELECT 
                    (SELECT COUNT(*) FROM user_profiles) as total_users,
                    (SELECT COUNT(*) FROM user_profiles WHERE firebase_uid LIKE 'temp_%') as temp_uids,
                    (SELECT COUNT(*) FROM donations WHERE donor_id IS NOT NULL) as donations_with_donors,
                    (SELECT COUNT(*) FROM chat_messages) as total_messages;
            "
        fi
        
    else
        echo ""
        echo -e "${RED}═══════════════════════════════════════════════════════════════${NC}"
        echo -e "${RED}❌ Migration failed!${NC}"
        echo -e "${RED}═══════════════════════════════════════════════════════════════${NC}"
        echo ""
        echo -e "${YELLOW}To restore from backup:${NC}"
        if [ -n "$CONTAINER_NAME" ]; then
            echo "docker exec -i $CONTAINER_NAME psql -U $DB_USER $DB_NAME < $BACKUP_FILE"
        else
            echo "PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME < $BACKUP_FILE"
        fi
        exit 1
    fi
}

# Check if migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}Error: Migration file not found: $MIGRATION_FILE${NC}"
    exit 1
fi

# Run main
main

