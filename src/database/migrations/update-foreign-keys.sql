-- Migration: Update all foreign keys to use TEXT (firebase_uid) instead of UUID
-- This script updates all tables that reference user_profiles to use firebase_uid (TEXT) instead of id (UUID)

BEGIN;

-- Update donations table
ALTER TABLE IF EXISTS donations
  ALTER COLUMN donor_id TYPE TEXT USING donor_id::TEXT,
  ALTER COLUMN recipient_id TYPE TEXT USING recipient_id::TEXT;

-- Update rides table  
ALTER TABLE IF EXISTS rides
  ALTER COLUMN driver_id TYPE TEXT USING driver_id::TEXT;

-- Update ride_requests table
ALTER TABLE IF EXISTS ride_requests
  ALTER COLUMN passenger_id TYPE TEXT USING passenger_id::TEXT;

-- Update events table
ALTER TABLE IF EXISTS events
  ALTER COLUMN organizer_id TYPE TEXT USING organizer_id::TEXT;

-- Update event_participants table
ALTER TABLE IF EXISTS event_participants
  ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;

-- Update posts table
ALTER TABLE IF EXISTS posts
  ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT;

-- Update chat_messages table
ALTER TABLE IF EXISTS chat_messages
  ALTER COLUMN sender_id TYPE TEXT USING sender_id::TEXT;

-- Update user_activities table
ALTER TABLE IF EXISTS user_activities
  ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;

-- Update activity_participants table  
ALTER TABLE IF EXISTS activity_participants
  ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;

-- Update user_follows table
ALTER TABLE IF EXISTS user_follows
  ALTER COLUMN follower_id TYPE TEXT USING follower_id::TEXT,
  ALTER COLUMN following_id TYPE TEXT USING following_id::TEXT;

-- Update user_notifications table
ALTER TABLE IF EXISTS user_notifications
  ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;

-- Update organizations table
ALTER TABLE IF EXISTS organizations
  ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT;

-- Update organization_applications table
ALTER TABLE IF EXISTS organization_applications
  ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT,
  ALTER COLUMN reviewed_by TYPE TEXT USING reviewed_by::TEXT;

-- Update challenges table (if exists)
ALTER TABLE IF EXISTS challenges
  ALTER COLUMN creator_id TYPE TEXT USING creator_id::TEXT;

-- Update challenge_participants table (if exists)
ALTER TABLE IF EXISTS challenge_participants
  ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;

-- Update tasks table (if exists)
ALTER TABLE IF EXISTS tasks
  ALTER COLUMN assignees TYPE TEXT[] USING assignees::TEXT[];

COMMIT;

SELECT 'Foreign keys updated successfully' AS status;

