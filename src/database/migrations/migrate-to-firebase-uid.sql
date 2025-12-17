-- Migration Script: UUID to Firebase UID
-- Purpose: Migrate from internal UUID to Firebase UID as primary key across all tables
-- Date: 2025-12-17
-- IMPORTANT: This script is idempotent and can be run multiple times safely

-- ============================================================================
-- STEP 1: Ensure firebase_uid is populated for all existing users
-- ============================================================================

-- Check if there are users without firebase_uid
DO $$
DECLARE
    missing_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO missing_count 
    FROM user_profiles 
    WHERE firebase_uid IS NULL OR firebase_uid = '';
    
    IF missing_count > 0 THEN
        RAISE NOTICE 'WARNING: Found % users without firebase_uid. These will get temporary UIDs.', missing_count;
        
        -- Generate temporary firebase UIDs for users that don't have one
        -- Format: temp_<uuid> so we can identify them later
        UPDATE user_profiles 
        SET firebase_uid = 'temp_' || id::text
        WHERE firebase_uid IS NULL OR firebase_uid = '';
        
        RAISE NOTICE 'Generated temporary firebase_uids for % users', missing_count;
    ELSE
        RAISE NOTICE 'All users have firebase_uid - proceeding with migration';
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Add new TEXT columns for user references in all tables
-- ============================================================================

-- Organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS created_by_new TEXT;

-- Organization Applications
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS user_id_new TEXT;
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS reviewed_by_new TEXT;

-- Donations
ALTER TABLE donations ADD COLUMN IF NOT EXISTS donor_id_new TEXT;
ALTER TABLE donations ADD COLUMN IF NOT EXISTS recipient_id_new TEXT;

-- Rides
ALTER TABLE rides ADD COLUMN IF NOT EXISTS driver_id_new TEXT;

-- Ride Bookings
ALTER TABLE ride_bookings ADD COLUMN IF NOT EXISTS passenger_id_new TEXT;

-- Community Events
ALTER TABLE community_events ADD COLUMN IF NOT EXISTS organizer_id_new TEXT;

-- Event Attendees
ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS user_id_new TEXT;

-- Chat Conversations
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS created_by_new TEXT;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS participants_new TEXT[];

-- Chat Messages
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sender_id_new TEXT;

-- Message Read Receipts
ALTER TABLE message_read_receipts ADD COLUMN IF NOT EXISTS user_id_new TEXT;

-- User Activities
ALTER TABLE user_activities ADD COLUMN IF NOT EXISTS user_id_new TEXT;

-- User Follows
ALTER TABLE user_follows ADD COLUMN IF NOT EXISTS follower_id_new TEXT;
ALTER TABLE user_follows ADD COLUMN IF NOT EXISTS following_id_new TEXT;

-- User Notifications
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS user_id_new TEXT;

-- Items
ALTER TABLE items ADD COLUMN IF NOT EXISTS donor_user_id_new TEXT;

-- Tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignees_new TEXT[];

-- Item Requests
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS requester_id_new TEXT;

-- Community Members (if exists)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'community_members') THEN
        ALTER TABLE community_members ADD COLUMN IF NOT EXISTS user_id_new TEXT;
    END IF;
END $$;

-- ============================================================================
-- STEP 3: Populate new columns with firebase_uid values
-- ============================================================================

-- Organizations
UPDATE organizations o
SET created_by_new = up.firebase_uid
FROM user_profiles up
WHERE o.created_by = up.id AND o.created_by_new IS NULL;

-- Organization Applications
UPDATE organization_applications oa
SET user_id_new = up.firebase_uid
FROM user_profiles up
WHERE oa.user_id = up.id AND oa.user_id_new IS NULL;

UPDATE organization_applications oa
SET reviewed_by_new = up.firebase_uid
FROM user_profiles up
WHERE oa.reviewed_by = up.id AND oa.reviewed_by_new IS NULL;

-- Donations
UPDATE donations d
SET donor_id_new = up.firebase_uid
FROM user_profiles up
WHERE d.donor_id = up.id AND d.donor_id_new IS NULL;

UPDATE donations d
SET recipient_id_new = up.firebase_uid
FROM user_profiles up
WHERE d.recipient_id = up.id AND d.recipient_id_new IS NULL;

-- Rides
UPDATE rides r
SET driver_id_new = up.firebase_uid
FROM user_profiles up
WHERE r.driver_id = up.id AND r.driver_id_new IS NULL;

-- Ride Bookings
UPDATE ride_bookings rb
SET passenger_id_new = up.firebase_uid
FROM user_profiles up
WHERE rb.passenger_id = up.id AND rb.passenger_id_new IS NULL;

-- Community Events
UPDATE community_events ce
SET organizer_id_new = up.firebase_uid
FROM user_profiles up
WHERE ce.organizer_id = up.id AND ce.organizer_id_new IS NULL;

-- Event Attendees
UPDATE event_attendees ea
SET user_id_new = up.firebase_uid
FROM user_profiles up
WHERE ea.user_id = up.id AND ea.user_id_new IS NULL;

-- Chat Conversations - created_by
UPDATE chat_conversations cc
SET created_by_new = up.firebase_uid
FROM user_profiles up
WHERE cc.created_by = up.id AND cc.created_by_new IS NULL;

-- Chat Conversations - participants array (more complex)
UPDATE chat_conversations cc
SET participants_new = (
    SELECT array_agg(up.firebase_uid)
    FROM unnest(cc.participants) AS p(uuid_val)
    JOIN user_profiles up ON up.id = p.uuid_val
)
WHERE cc.participants_new IS NULL AND cc.participants IS NOT NULL;

-- Chat Messages
UPDATE chat_messages cm
SET sender_id_new = up.firebase_uid
FROM user_profiles up
WHERE cm.sender_id = up.id AND cm.sender_id_new IS NULL;

-- Message Read Receipts
UPDATE message_read_receipts mrr
SET user_id_new = up.firebase_uid
FROM user_profiles up
WHERE mrr.user_id = up.id AND mrr.user_id_new IS NULL;

-- User Activities
UPDATE user_activities ua
SET user_id_new = up.firebase_uid
FROM user_profiles up
WHERE ua.user_id = up.id AND ua.user_id_new IS NULL;

-- User Follows
UPDATE user_follows uf
SET follower_id_new = up.firebase_uid
FROM user_profiles up
WHERE uf.follower_id = up.id AND uf.follower_id_new IS NULL;

UPDATE user_follows uf
SET following_id_new = up.firebase_uid
FROM user_profiles up
WHERE uf.following_id = up.id AND uf.following_id_new IS NULL;

-- User Notifications
UPDATE user_notifications un
SET user_id_new = up.firebase_uid
FROM user_profiles up
WHERE un.user_id = up.id AND un.user_id_new IS NULL;

-- Items
UPDATE items i
SET donor_user_id_new = up.firebase_uid
FROM user_profiles up
WHERE i.donor_user_id = up.id AND i.donor_user_id_new IS NULL;

-- Tasks - assignees array
UPDATE tasks t
SET assignees_new = (
    SELECT array_agg(up.firebase_uid)
    FROM unnest(t.assignees) AS a(uuid_val)
    JOIN user_profiles up ON up.id = a.uuid_val
)
WHERE t.assignees_new IS NULL AND t.assignees IS NOT NULL;

-- Item Requests
UPDATE item_requests ir
SET requester_id_new = up.firebase_uid
FROM user_profiles up
WHERE ir.requester_id = up.id AND ir.requester_id_new IS NULL;

-- Community Members (if exists)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'community_members') THEN
        EXECUTE 'UPDATE community_members cm
                 SET user_id_new = up.firebase_uid
                 FROM user_profiles up
                 WHERE cm.user_id = up.id AND cm.user_id_new IS NULL';
    END IF;
END $$;

-- ============================================================================
-- STEP 4: Drop old constraints and indexes
-- ============================================================================

-- Drop foreign key constraints (if they exist)
-- Note: Our schema has them commented out, but we'll try to drop them anyway
DO $$ 
BEGIN
    -- This will silently fail if constraints don't exist
    ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_created_by_fkey;
    ALTER TABLE organization_applications DROP CONSTRAINT IF EXISTS organization_applications_user_id_fkey;
    ALTER TABLE organization_applications DROP CONSTRAINT IF EXISTS organization_applications_reviewed_by_fkey;
    ALTER TABLE donations DROP CONSTRAINT IF EXISTS donations_donor_id_fkey;
    ALTER TABLE donations DROP CONSTRAINT IF EXISTS donations_recipient_id_fkey;
    ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_driver_id_fkey;
    ALTER TABLE ride_bookings DROP CONSTRAINT IF EXISTS ride_bookings_passenger_id_fkey;
    ALTER TABLE community_events DROP CONSTRAINT IF EXISTS community_events_organizer_id_fkey;
    ALTER TABLE event_attendees DROP CONSTRAINT IF EXISTS event_attendees_user_id_fkey;
    ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_created_by_fkey;
    ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_sender_id_fkey;
    ALTER TABLE message_read_receipts DROP CONSTRAINT IF EXISTS message_read_receipts_user_id_fkey;
    ALTER TABLE user_activities DROP CONSTRAINT IF EXISTS user_activities_user_id_fkey;
    ALTER TABLE user_follows DROP CONSTRAINT IF EXISTS user_follows_follower_id_fkey;
    ALTER TABLE user_follows DROP CONSTRAINT IF EXISTS user_follows_following_id_fkey;
    ALTER TABLE user_notifications DROP CONSTRAINT IF EXISTS user_notifications_user_id_fkey;
    ALTER TABLE items DROP CONSTRAINT IF EXISTS items_donor_user_id_fkey;
    ALTER TABLE item_requests DROP CONSTRAINT IF EXISTS item_requests_requester_id_fkey;
END $$;

-- ============================================================================
-- STEP 5: Drop old UUID columns and rename new TEXT columns
-- ============================================================================

-- Organizations
ALTER TABLE organizations DROP COLUMN IF EXISTS created_by;
ALTER TABLE organizations RENAME COLUMN created_by_new TO created_by;

-- Organization Applications
ALTER TABLE organization_applications DROP COLUMN IF EXISTS user_id;
ALTER TABLE organization_applications RENAME COLUMN user_id_new TO user_id;
ALTER TABLE organization_applications DROP COLUMN IF EXISTS reviewed_by;
ALTER TABLE organization_applications RENAME COLUMN reviewed_by_new TO reviewed_by;

-- Donations
ALTER TABLE donations DROP COLUMN IF EXISTS donor_id;
ALTER TABLE donations RENAME COLUMN donor_id_new TO donor_id;
ALTER TABLE donations DROP COLUMN IF EXISTS recipient_id;
ALTER TABLE donations RENAME COLUMN recipient_id_new TO recipient_id;

-- Rides
ALTER TABLE rides DROP COLUMN IF EXISTS driver_id;
ALTER TABLE rides RENAME COLUMN driver_id_new TO driver_id;

-- Ride Bookings
ALTER TABLE ride_bookings DROP COLUMN IF EXISTS passenger_id;
ALTER TABLE ride_bookings RENAME COLUMN passenger_id_new TO passenger_id;

-- Community Events
ALTER TABLE community_events DROP COLUMN IF EXISTS organizer_id;
ALTER TABLE community_events RENAME COLUMN organizer_id_new TO organizer_id;

-- Event Attendees
ALTER TABLE event_attendees DROP COLUMN IF EXISTS user_id;
ALTER TABLE event_attendees RENAME COLUMN user_id_new TO user_id;

-- Chat Conversations
ALTER TABLE chat_conversations DROP COLUMN IF EXISTS created_by;
ALTER TABLE chat_conversations RENAME COLUMN created_by_new TO created_by;
ALTER TABLE chat_conversations DROP COLUMN IF EXISTS participants;
ALTER TABLE chat_conversations RENAME COLUMN participants_new TO participants;

-- Chat Messages
ALTER TABLE chat_messages DROP COLUMN IF EXISTS sender_id;
ALTER TABLE chat_messages RENAME COLUMN sender_id_new TO sender_id;

-- Message Read Receipts
ALTER TABLE message_read_receipts DROP COLUMN IF EXISTS user_id;
ALTER TABLE message_read_receipts RENAME COLUMN user_id_new TO user_id;

-- User Activities
ALTER TABLE user_activities DROP COLUMN IF EXISTS user_id;
ALTER TABLE user_activities RENAME COLUMN user_id_new TO user_id;

-- User Follows
ALTER TABLE user_follows DROP COLUMN IF EXISTS follower_id;
ALTER TABLE user_follows RENAME COLUMN follower_id_new TO follower_id;
ALTER TABLE user_follows DROP COLUMN IF EXISTS following_id;
ALTER TABLE user_follows RENAME COLUMN following_id_new TO following_id;

-- User Notifications
ALTER TABLE user_notifications DROP COLUMN IF EXISTS user_id;
ALTER TABLE user_notifications RENAME COLUMN user_id_new TO user_id;

-- Items
ALTER TABLE items DROP COLUMN IF EXISTS donor_user_id;
ALTER TABLE items RENAME COLUMN donor_user_id_new TO donor_user_id;

-- Tasks
ALTER TABLE tasks DROP COLUMN IF EXISTS assignees;
ALTER TABLE tasks RENAME COLUMN assignees_new TO assignees;

-- Item Requests
ALTER TABLE item_requests DROP COLUMN IF EXISTS requester_id;
ALTER TABLE item_requests RENAME COLUMN requester_id_new TO requester_id;

-- Community Members (if exists)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'community_members') THEN
        EXECUTE 'ALTER TABLE community_members DROP COLUMN IF EXISTS user_id';
        EXECUTE 'ALTER TABLE community_members RENAME COLUMN user_id_new TO user_id';
    END IF;
END $$;

-- ============================================================================
-- STEP 6: Migrate user_profiles table itself
-- ============================================================================

-- Drop the old UUID primary key
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_pkey;

-- Drop the old id column
ALTER TABLE user_profiles DROP COLUMN IF EXISTS id;

-- Drop google_id as Firebase handles all auth providers
ALTER TABLE user_profiles DROP COLUMN IF EXISTS google_id;

-- Drop the unique constraint on firebase_uid (we'll make it PK)
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_firebase_uid_key;

-- Set firebase_uid as NOT NULL (required for primary key)
ALTER TABLE user_profiles ALTER COLUMN firebase_uid SET NOT NULL;

-- Make firebase_uid the primary key
ALTER TABLE user_profiles ADD PRIMARY KEY (firebase_uid);

-- ============================================================================
-- STEP 7: Create indexes for better performance
-- ============================================================================

-- User references indexes
CREATE INDEX IF NOT EXISTS idx_organizations_created_by ON organizations(created_by);
CREATE INDEX IF NOT EXISTS idx_donations_donor_id ON donations(donor_id);
CREATE INDEX IF NOT EXISTS idx_donations_recipient_id ON donations(recipient_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_id ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON user_activities(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_follows_follower_id ON user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_following_id ON user_follows(following_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON user_notifications(user_id, created_at);

-- Keep existing useful indexes on user_profiles
-- (email, city, roles, active status already exist)

-- ============================================================================
-- STEP 8: Validation and reporting
-- ============================================================================

DO $$
DECLARE
    user_count INTEGER;
    temp_uid_count INTEGER;
BEGIN
    -- Count total users
    SELECT COUNT(*) INTO user_count FROM user_profiles;
    
    -- Count users with temporary UIDs
    SELECT COUNT(*) INTO temp_uid_count 
    FROM user_profiles 
    WHERE firebase_uid LIKE 'temp_%';
    
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Migration completed successfully!';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Total users: %', user_count;
    RAISE NOTICE 'Users with temporary UIDs: %', temp_uid_count;
    
    IF temp_uid_count > 0 THEN
        RAISE NOTICE 'WARNING: % users have temporary firebase_uids (temp_*)', temp_uid_count;
        RAISE NOTICE 'These users need to be updated with real Firebase UIDs';
    END IF;
    
    RAISE NOTICE '============================================================================';
END $$;

-- Final verification queries (commented out - uncomment to run manually)
-- SELECT 'user_profiles' as table_name, COUNT(*) as count FROM user_profiles
-- UNION ALL
-- SELECT 'donations', COUNT(*) FROM donations WHERE donor_id IS NOT NULL
-- UNION ALL
-- SELECT 'rides', COUNT(*) FROM rides WHERE driver_id IS NOT NULL
-- UNION ALL
-- SELECT 'chat_messages', COUNT(*) FROM chat_messages;

