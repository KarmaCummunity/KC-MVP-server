-- KC MVP Database Schema
-- Full database schema for Karma Community MVP application

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Enhanced Users table with detailed profile information
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    avatar_url TEXT,
    bio TEXT,
    karma_points INTEGER DEFAULT 0,
    join_date TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    last_active TIMESTAMPTZ DEFAULT NOW(),
    city VARCHAR(100),
    country VARCHAR(100) DEFAULT 'Israel',
    interests TEXT[], -- Array of interests
    roles TEXT[] DEFAULT ARRAY['user'], -- user, org_admin, admin
    posts_count INTEGER DEFAULT 0,
    followers_count INTEGER DEFAULT 0,
    following_count INTEGER DEFAULT 0,
    total_donations_amount DECIMAL(10,2) DEFAULT 0,
    total_volunteer_hours INTEGER DEFAULT 0,
    password_hash TEXT,
    email_verified BOOLEAN DEFAULT false,
    settings JSONB DEFAULT '{
        "language": "he",
        "dark_mode": false,
        "notifications_enabled": true,
        "privacy": "public"
    }'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create a view to map old user_id to new user_profiles.id for backward compatibility
CREATE OR REPLACE VIEW user_id_mapping AS
SELECT 
    user_id as old_user_id,
    id as new_user_id
FROM users u
JOIN user_profiles up ON u.data->>'email' = up.email
WHERE u.data->>'email' IS NOT NULL;

-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    website_url TEXT,
    contact_email VARCHAR(255),
    contact_phone VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    registration_number VARCHAR(50),
    organization_type VARCHAR(50), -- ngo, charity, community, etc.
    activity_areas TEXT[], -- Array of activity areas
    logo_url TEXT,
    is_verified BOOLEAN DEFAULT false,
    status VARCHAR(20) DEFAULT 'active', -- active, inactive, pending
    created_by UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Organization applications (for org admin approval)
CREATE TABLE IF NOT EXISTS organization_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    organization_id UUID, -- REFERENCES organizations(id), -- Temporarily disabled for backward compatibility
    applicant_email VARCHAR(255) NOT NULL,
    org_name VARCHAR(255) NOT NULL,
    org_description TEXT,
    org_type VARCHAR(50),
    activity_areas TEXT[],
    contact_info JSONB,
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    application_data JSONB,
    reviewed_by UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Donation categories table
CREATE TABLE IF NOT EXISTS donation_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(50) UNIQUE NOT NULL, -- money, trump, knowledge, etc.
    name_he VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    description_he TEXT,
    description_en TEXT,
    icon VARCHAR(50), -- emoji or icon name
    color VARCHAR(7), -- hex color
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Donations table with detailed tracking
CREATE TABLE IF NOT EXISTS donations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    donor_id UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    recipient_id UUID, -- REFERENCES user_profiles(id), -- can be null for general donations
    organization_id UUID REFERENCES organizations(id), -- can be null
    category_id UUID REFERENCES donation_categories(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    amount DECIMAL(10,2), -- for money donations
    currency VARCHAR(3) DEFAULT 'ILS',
    type VARCHAR(20) NOT NULL, -- money, item, service, time, trump
    status VARCHAR(20) DEFAULT 'active', -- active, completed, cancelled, expired
    location JSONB, -- {city, address, coordinates}
    images TEXT[], -- array of image URLs
    tags TEXT[],
    metadata JSONB, -- flexible field for type-specific data
    expires_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rides table (Trump/carpooling)
CREATE TABLE IF NOT EXISTS rides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    title VARCHAR(255),
    from_location JSONB NOT NULL, -- {name, city, coordinates}
    to_location JSONB NOT NULL, -- {name, city, coordinates}
    departure_time TIMESTAMPTZ NOT NULL,
    arrival_time TIMESTAMPTZ,
    available_seats INTEGER DEFAULT 1,
    price_per_seat DECIMAL(10,2) DEFAULT 0,
    description TEXT,
    requirements TEXT, -- smoking, pets, etc.
    status VARCHAR(20) DEFAULT 'active', -- active, full, cancelled, completed
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ride requests/bookings
CREATE TABLE IF NOT EXISTS ride_bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID REFERENCES rides(id),
    passenger_id UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    seats_requested INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, cancelled
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ride_id, passenger_id)
);

-- Community events
CREATE TABLE IF NOT EXISTS community_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organizer_id UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    organization_id UUID REFERENCES organizations(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ,
    location JSONB, -- {name, address, city, coordinates}
    max_attendees INTEGER,
    current_attendees INTEGER DEFAULT 0,
    category VARCHAR(50),
    tags TEXT[],
    image_url TEXT,
    is_virtual BOOLEAN DEFAULT false,
    meeting_link TEXT,
    status VARCHAR(20) DEFAULT 'active', -- active, cancelled, completed
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event attendees
CREATE TABLE IF NOT EXISTS event_attendees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES community_events(id),
    user_id UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    status VARCHAR(20) DEFAULT 'going', -- going, maybe, not_going
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, user_id)
);

-- Enhanced chat conversations
CREATE TABLE IF NOT EXISTS chat_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255),
    type VARCHAR(20) DEFAULT 'direct', -- direct, group
    participants UUID[] NOT NULL,
    created_by UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    last_message_id UUID,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages with rich content support
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES chat_conversations(id),
    sender_id UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    content TEXT,
    message_type VARCHAR(20) DEFAULT 'text', -- text, image, file, voice, location, donation
    file_url TEXT,
    file_name VARCHAR(255),
    file_size INTEGER,
    file_type VARCHAR(100),
    metadata JSONB, -- coordinates for location, donation details, etc.
    reply_to_id UUID REFERENCES chat_messages(id),
    is_edited BOOLEAN DEFAULT false,
    edited_at TIMESTAMPTZ,
    is_deleted BOOLEAN DEFAULT false,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Read receipts for messages
CREATE TABLE IF NOT EXISTS message_read_receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID REFERENCES chat_messages(id),
    user_id UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    read_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, user_id)
);

-- User activity tracking for analytics
CREATE TABLE IF NOT EXISTS user_activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    activity_type VARCHAR(50) NOT NULL, -- login, donation, chat, view_category, etc.
    activity_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Community statistics aggregated table
CREATE TABLE IF NOT EXISTS community_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stat_type VARCHAR(50) NOT NULL, -- money_donations, volunteer_hours, etc.
    stat_value BIGINT DEFAULT 0,
    city VARCHAR(100),
    date_period DATE, -- for daily/monthly aggregation
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(stat_type, city, date_period)
);

-- User following relationships
CREATE TABLE IF NOT EXISTS user_follows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    following_id UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(follower_id, following_id)
);

-- User notifications
CREATE TABLE IF NOT EXISTS user_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID, -- REFERENCES user_profiles(id), -- Temporarily disabled for backward compatibility
    title VARCHAR(255),
    content TEXT,
    notification_type VARCHAR(50), -- donation, message, event, system
    related_id UUID, -- ID of related donation, message, etc.
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_email_lower ON user_profiles (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_user_profiles_city ON user_profiles (city);
CREATE INDEX IF NOT EXISTS idx_user_profiles_roles ON user_profiles USING GIN (roles);
CREATE INDEX IF NOT EXISTS idx_user_profiles_active ON user_profiles (is_active, last_active);

CREATE INDEX IF NOT EXISTS idx_donations_donor ON donations (donor_id);
CREATE INDEX IF NOT EXISTS idx_donations_category ON donations (category_id);
CREATE INDEX IF NOT EXISTS idx_donations_type ON donations (type);
CREATE INDEX IF NOT EXISTS idx_donations_status ON donations (status);
CREATE INDEX IF NOT EXISTS idx_donations_location ON donations USING GIN (location);
CREATE INDEX IF NOT EXISTS idx_donations_created ON donations (created_at);

CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides (driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_departure ON rides (departure_time);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides (status);
CREATE INDEX IF NOT EXISTS idx_rides_from_location ON rides USING GIN (from_location);
CREATE INDEX IF NOT EXISTS idx_rides_to_location ON rides USING GIN (to_location);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_participants ON chat_conversations USING GIN (participants);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages (sender_id);

CREATE INDEX IF NOT EXISTS idx_community_events_date ON community_events (event_date);
CREATE INDEX IF NOT EXISTS idx_community_events_organizer ON community_events (organizer_id);

CREATE INDEX IF NOT EXISTS idx_user_activities_user ON user_activities (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_activities_type ON user_activities (activity_type, created_at);

CREATE INDEX IF NOT EXISTS idx_community_stats_type ON community_stats (stat_type, date_period);
CREATE INDEX IF NOT EXISTS idx_community_stats_city ON community_stats (city, date_period);

-- Create triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to relevant tables
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_donations_updated_at BEFORE UPDATE ON donations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_rides_updated_at BEFORE UPDATE ON rides FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
