-- Migration Script V2: Add Firebase UID to existing schema
-- Purpose: Add firebase_uid as primary key to user_profiles and clean up
-- Date: 2025-12-17
-- IMPORTANT: This script is idempotent and can be run multiple times safely

BEGIN;

-- ============================================================================
-- STEP 1: Add firebase_uid column to user_profiles if it doesn't exist
-- ============================================================================

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS firebase_uid TEXT;

-- ============================================================================
-- STEP 2: Populate firebase_uid for existing users
-- ============================================================================

-- For existing users without firebase_uid, generate temporary ones based on email
-- Format: temp_<hash of email> so they're unique and identifiable
UPDATE user_profiles 
SET firebase_uid = 'temp_' || md5(email)
WHERE firebase_uid IS NULL OR firebase_uid = '';

-- ============================================================================
-- STEP 3: Make firebase_uid the primary key
-- ============================================================================

-- First, ensure firebase_uid is unique and not null
ALTER TABLE user_profiles ALTER COLUMN firebase_uid SET NOT NULL;

-- Drop the existing email unique constraint (we'll keep the index)
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_email_key;

-- Add primary key constraint on firebase_uid
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_pkey;
ALTER TABLE user_profiles ADD PRIMARY KEY (firebase_uid);

-- Re-add unique constraint on email (still important)
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_email_key UNIQUE (email);

-- ============================================================================
-- STEP 4: Check and fix existing TEXT foreign keys
-- ============================================================================

-- Most tables already use TEXT for user references, but let's verify and fix any NULL values

-- Donations: donor_id and recipient_id are already TEXT
-- Check if there are any invalid references
DO $$
DECLARE
    invalid_donors INTEGER;
    invalid_recipients INTEGER;
BEGIN
    SELECT COUNT(*) INTO invalid_donors
    FROM donations d
    WHERE d.donor_id IS NOT NULL 
      AND d.donor_id != ''
      AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE firebase_uid = d.donor_id);
    
    SELECT COUNT(*) INTO invalid_recipients
    FROM donations d
    WHERE d.recipient_id IS NOT NULL 
      AND d.recipient_id != ''
      AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE firebase_uid = d.recipient_id);
    
    IF invalid_donors > 0 THEN
        RAISE WARNING 'Found % donations with invalid donor_id references', invalid_donors;
    END IF;
    
    IF invalid_recipients > 0 THEN
        RAISE WARNING 'Found % donations with invalid recipient_id references', invalid_recipients;
    END IF;
END $$;

-- Chat Messages: sender_id is already TEXT
DO $$
DECLARE
    invalid_senders INTEGER;
BEGIN
    SELECT COUNT(*) INTO invalid_senders
    FROM chat_messages cm
    WHERE cm.sender_id IS NOT NULL 
      AND cm.sender_id != ''
      AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE firebase_uid = cm.sender_id);
    
    IF invalid_senders > 0 THEN
        RAISE WARNING 'Found % chat messages with invalid sender_id references', invalid_senders;
    END IF;
END $$;

-- Rides: Check driver_id
DO $$
BEGIN
    -- Add column if it doesn't exist as TEXT
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'rides' AND column_name = 'driver_id') THEN
        ALTER TABLE rides ADD COLUMN driver_id TEXT;
    END IF;
END $$;

-- Ride Bookings: Check passenger_id
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'ride_bookings' AND column_name = 'passenger_id') THEN
        ALTER TABLE ride_bookings ADD COLUMN passenger_id TEXT;
    END IF;
END $$;

-- Tasks: Check if assignees exists and is TEXT[]
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'tasks' AND column_name = 'assignees') THEN
        ALTER TABLE tasks ADD COLUMN assignees TEXT[];
    END IF;
END $$;

-- Organizations: Check created_by
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'created_by') THEN
        ALTER TABLE organizations ADD COLUMN created_by TEXT;
    END IF;
END $$;

-- Community Events: Check organizer_id
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'community_events' AND column_name = 'organizer_id') THEN
        ALTER TABLE community_events ADD COLUMN organizer_id TEXT;
    END IF;
END $$;

-- Event Attendees: Check user_id
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'event_attendees' AND column_name = 'user_id') THEN
        ALTER TABLE event_attendees ADD COLUMN user_id TEXT;
    END IF;
END $$;

-- Chat Conversations: Check created_by and participants
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'chat_conversations' AND column_name = 'created_by') THEN
        ALTER TABLE chat_conversations ADD COLUMN created_by TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'chat_conversations' AND column_name = 'participants') THEN
        ALTER TABLE chat_conversations ADD COLUMN participants TEXT[];
    END IF;
END $$;

-- User Activities: Check user_id
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_activities' AND column_name = 'user_id') THEN
        ALTER TABLE user_activities ADD COLUMN user_id TEXT;
    END IF;
END $$;

-- ============================================================================
-- STEP 5: Drop the legacy 'users' table if it exists
-- ============================================================================

DO $$
DECLARE
    legacy_user_count INTEGER;
BEGIN
    -- Check if legacy users table exists and has data
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        SELECT COUNT(*) INTO legacy_user_count FROM users;
        
        RAISE NOTICE 'Found legacy users table with % records', legacy_user_count;
        RAISE NOTICE 'Consider migrating any data from users to user_profiles before dropping';
        
        -- Uncomment the following line to actually drop the table
        -- DROP TABLE users CASCADE;
        RAISE NOTICE 'Legacy users table NOT dropped (commented out for safety)';
    END IF;
END $$;

-- ============================================================================
-- STEP 6: Create useful indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_user_profiles_firebase_uid ON user_profiles(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_donations_donor_id ON donations(donor_id);
CREATE INDEX IF NOT EXISTS idx_donations_recipient_id ON donations(recipient_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_id ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON rides(driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_created_by ON organizations(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON user_activities(user_id) WHERE user_id IS NOT NULL;

-- ============================================================================
-- STEP 7: Validation and reporting
-- ============================================================================

DO $$
DECLARE
    user_count INTEGER;
    temp_uid_count INTEGER;
    donations_count INTEGER;
    messages_count INTEGER;
    legacy_count INTEGER := 0;
BEGIN
    -- Count total users
    SELECT COUNT(*) INTO user_count FROM user_profiles;
    
    -- Count users with temporary UIDs
    SELECT COUNT(*) INTO temp_uid_count 
    FROM user_profiles 
    WHERE firebase_uid LIKE 'temp_%';
    
    -- Count related records
    SELECT COUNT(*) INTO donations_count FROM donations WHERE donor_id IS NOT NULL;
    SELECT COUNT(*) INTO messages_count FROM chat_messages WHERE sender_id IS NOT NULL;
    
    -- Check legacy users table
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        SELECT COUNT(*) INTO legacy_count FROM users;
    END IF;
    
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Migration V2 completed successfully!';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Total users in user_profiles: %', user_count;
    RAISE NOTICE 'Users with temporary Firebase UIDs: %', temp_uid_count;
    RAISE NOTICE 'Donations with donor_id: %', donations_count;
    RAISE NOTICE 'Chat messages with sender_id: %', messages_count;
    RAISE NOTICE 'Records in legacy users table: %', legacy_count;
    RAISE NOTICE '============================================================================';
    
    IF temp_uid_count > 0 THEN
        RAISE NOTICE 'ACTION REQUIRED: % users have temporary firebase_uids (temp_*)', temp_uid_count;
        RAISE NOTICE 'These need to be updated with real Firebase UIDs when users login';
    END IF;
    
    IF legacy_count > 0 THEN
        RAISE NOTICE 'ACTION REQUIRED: Legacy users table still exists with % records', legacy_count;
        RAISE NOTICE 'Review and migrate data before dropping the table';
    END IF;
    
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Update server authentication to use firebase_uid';
    RAISE NOTICE '2. Test login/registration flows';
    RAISE NOTICE '3. Migrate or drop legacy users table';
    RAISE NOTICE '============================================================================';
END $$;

COMMIT;

-- Show sample data
SELECT 
    firebase_uid,
    email,
    name,
    CASE WHEN firebase_uid LIKE 'temp_%' THEN '⚠️ TEMP' ELSE '✅ REAL' END as uid_status
FROM user_profiles
LIMIT 10;

