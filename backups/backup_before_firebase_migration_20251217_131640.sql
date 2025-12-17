--
-- PostgreSQL database dump
--

\restrict vAC8svFKPPttIoe9bgK9MiBKmC7nzTp1fz9f16i0aqkcia6NpLNIi2JQYQEEieT

-- Dumped from database version 15.15 (Debian 15.15-1.pgdg13+1)
-- Dumped by pg_dump version 15.15 (Debian 15.15-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: analytics; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.analytics (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.analytics OWNER TO kc;

--
-- Name: blocked_users; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.blocked_users (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.blocked_users OWNER TO kc;

--
-- Name: bookmarks; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.bookmarks (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.bookmarks OWNER TO kc;

--
-- Name: chat_conversations; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.chat_conversations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title character varying(255),
    type character varying(20) DEFAULT 'direct'::character varying,
    participants uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    created_by uuid,
    last_message_id uuid,
    last_message_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.chat_conversations OWNER TO kc;

--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    conversation_id uuid,
    sender_id uuid,
    content text,
    message_type character varying(20) DEFAULT 'text'::character varying,
    file_url text,
    file_name character varying(255),
    file_size integer,
    file_type character varying(100),
    metadata jsonb,
    reply_to_id uuid,
    is_edited boolean DEFAULT false,
    edited_at timestamp with time zone,
    is_deleted boolean DEFAULT false,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.chat_messages OWNER TO kc;

--
-- Name: chats; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.chats (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.chats OWNER TO kc;

--
-- Name: community_events; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.community_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organizer_id uuid,
    organization_id uuid,
    title character varying(255) NOT NULL,
    description text,
    event_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone,
    location jsonb,
    max_attendees integer,
    current_attendees integer DEFAULT 0,
    category character varying(50),
    tags text[],
    image_url text,
    is_virtual boolean DEFAULT false,
    meeting_link text,
    status character varying(20) DEFAULT 'active'::character varying,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.community_events OWNER TO kc;

--
-- Name: community_stats; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.community_stats (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    stat_type character varying(50) NOT NULL,
    stat_value bigint DEFAULT 0,
    city character varying(100),
    date_period date,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.community_stats OWNER TO kc;

--
-- Name: conversation_metadata; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.conversation_metadata (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.conversation_metadata OWNER TO kc;

--
-- Name: donation_categories; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.donation_categories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    slug character varying(50) NOT NULL,
    name_he character varying(100) NOT NULL,
    name_en character varying(100) NOT NULL,
    description_he text,
    description_en text,
    icon character varying(50),
    color character varying(7),
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.donation_categories OWNER TO kc;

--
-- Name: donations; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.donations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    donor_id uuid,
    recipient_id uuid,
    organization_id uuid,
    category_id uuid,
    title character varying(255) NOT NULL,
    description text,
    amount numeric(10,2),
    currency character varying(3) DEFAULT 'ILS'::character varying,
    type character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying,
    is_recurring boolean DEFAULT false,
    location jsonb,
    images text[],
    tags text[],
    metadata jsonb,
    expires_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.donations OWNER TO kc;

--
-- Name: event_attendees; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.event_attendees (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    event_id uuid,
    user_id uuid,
    status character varying(20) DEFAULT 'going'::character varying,
    registered_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.event_attendees OWNER TO kc;

--
-- Name: followers; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.followers (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.followers OWNER TO kc;

--
-- Name: following; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.following (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.following OWNER TO kc;

--
-- Name: media; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.media (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.media OWNER TO kc;

--
-- Name: message_reactions; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.message_reactions (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.message_reactions OWNER TO kc;

--
-- Name: message_read_receipts; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.message_read_receipts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    message_id uuid,
    user_id uuid,
    read_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.message_read_receipts OWNER TO kc;

--
-- Name: messages; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.messages (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.messages OWNER TO kc;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.notifications (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.notifications OWNER TO kc;

--
-- Name: org_applications; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.org_applications (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.org_applications OWNER TO kc;

--
-- Name: organizations; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.organizations (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.organizations OWNER TO kc;

--
-- Name: posts; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.posts (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.posts OWNER TO kc;

--
-- Name: read_receipts; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.read_receipts (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.read_receipts OWNER TO kc;

--
-- Name: ride_bookings; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.ride_bookings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ride_id uuid,
    passenger_id uuid,
    seats_requested integer DEFAULT 1,
    status character varying(20) DEFAULT 'pending'::character varying,
    message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.ride_bookings OWNER TO kc;

--
-- Name: rides; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.rides (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    driver_id uuid,
    title character varying(255),
    from_location jsonb NOT NULL,
    to_location jsonb NOT NULL,
    departure_time timestamp with time zone NOT NULL,
    arrival_time timestamp with time zone,
    available_seats integer DEFAULT 1,
    price_per_seat numeric(10,2) DEFAULT 0,
    description text,
    requirements text,
    status character varying(20) DEFAULT 'active'::character varying,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.rides OWNER TO kc;

--
-- Name: settings; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.settings (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.settings OWNER TO kc;

--
-- Name: tasks; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.tasks (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.tasks OWNER TO kc;

--
-- Name: typing_status; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.typing_status (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.typing_status OWNER TO kc;

--
-- Name: user_activities; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.user_activities (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    activity_type character varying(50) NOT NULL,
    activity_data jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.user_activities OWNER TO kc;

--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.user_profiles (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    phone character varying(20),
    avatar_url text,
    bio text,
    karma_points integer DEFAULT 0,
    join_date timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    last_active timestamp with time zone DEFAULT now(),
    city character varying(100),
    country character varying(100) DEFAULT 'Israel'::character varying,
    interests text[],
    roles text[] DEFAULT ARRAY['user'::text],
    posts_count integer DEFAULT 0,
    followers_count integer DEFAULT 0,
    following_count integer DEFAULT 0,
    total_donations_amount numeric(10,2) DEFAULT 0,
    total_volunteer_hours integer DEFAULT 0,
    password_hash text,
    email_verified boolean DEFAULT false,
    settings jsonb DEFAULT '{"privacy": "public", "language": "he", "dark_mode": false, "notifications_enabled": true}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.user_profiles OWNER TO kc;

--
-- Name: users; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.users (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.users OWNER TO kc;

--
-- Name: voice_messages; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.voice_messages (
    user_id text NOT NULL,
    item_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.voice_messages OWNER TO kc;

--
-- Data for Name: analytics; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.analytics (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: blocked_users; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.blocked_users (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: bookmarks; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.bookmarks (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: chat_conversations; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.chat_conversations (id, title, type, participants, created_by, last_message_id, last_message_at, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: chat_messages; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.chat_messages (id, conversation_id, sender_id, content, message_type, file_url, file_name, file_size, file_type, metadata, reply_to_id, is_edited, edited_at, is_deleted, deleted_at, created_at) FROM stdin;
\.


--
-- Data for Name: chats; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.chats (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: community_events; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.community_events (id, organizer_id, organization_id, title, description, event_date, end_date, location, max_attendees, current_attendees, category, tags, image_url, is_virtual, meeting_link, status, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: community_stats; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.community_stats (id, stat_type, stat_value, city, date_period, metadata, created_at, updated_at) FROM stdin;
61e95549-72fa-4d92-8aac-188c1b5acefa	money_donations	0	\N	2025-11-25	\N	2025-11-25 09:37:33.465882+00	2025-11-25 09:37:33.465882+00
d025edbd-f932-4928-965c-baaddf0ae981	volunteer_hours	0	\N	2025-11-25	\N	2025-11-25 09:37:33.467293+00	2025-11-25 09:37:33.467293+00
060c32eb-38dc-4af7-a65b-b15ed9aae03c	rides_completed	0	\N	2025-11-25	\N	2025-11-25 09:37:33.468003+00	2025-11-25 09:37:33.468003+00
3b26902f-040d-4b48-bca4-6826c65b0132	events_created	0	\N	2025-11-25	\N	2025-11-25 09:37:33.468658+00	2025-11-25 09:37:33.468658+00
d4746c8b-589c-4714-ac0f-b8c242d39bab	active_members	0	\N	2025-11-25	\N	2025-11-25 09:37:33.46937+00	2025-11-25 09:37:33.46937+00
1e85f3f7-51bc-41b2-816c-589ad6d26e7b	food_kg	0	\N	2025-11-25	\N	2025-11-25 09:37:33.470144+00	2025-11-25 09:37:33.470144+00
f268fc2f-1fd2-44d2-b102-7ee93c4951f7	clothing_kg	0	\N	2025-11-25	\N	2025-11-25 09:37:33.470978+00	2025-11-25 09:37:33.470978+00
4fb16de8-adc7-48db-9c8a-311bf9976d0c	books_donated	0	\N	2025-11-25	\N	2025-11-25 09:37:33.471615+00	2025-11-25 09:37:33.471615+00
a0a22f54-4e6d-4bbe-864c-9d377351dd37	money_donations	0	\N	2025-11-25	\N	2025-11-25 09:37:51.591073+00	2025-11-25 09:37:51.591073+00
4262bee7-7a61-4cd8-a6a0-5c643897365b	volunteer_hours	0	\N	2025-11-25	\N	2025-11-25 09:37:51.591651+00	2025-11-25 09:37:51.591651+00
cac87479-4749-4e30-8cbc-be0fa56743b2	rides_completed	0	\N	2025-11-25	\N	2025-11-25 09:37:51.592427+00	2025-11-25 09:37:51.592427+00
ff2a2c81-5ba0-4b5c-8343-d7658c001f2d	events_created	0	\N	2025-11-25	\N	2025-11-25 09:37:51.593237+00	2025-11-25 09:37:51.593237+00
1e3d7393-48af-420c-87db-41c994336a9f	active_members	0	\N	2025-11-25	\N	2025-11-25 09:37:51.593895+00	2025-11-25 09:37:51.593895+00
bd92d933-4dad-454f-b7a3-05238ac9c991	food_kg	0	\N	2025-11-25	\N	2025-11-25 09:37:51.594393+00	2025-11-25 09:37:51.594393+00
9c61d3ec-3c73-440a-8544-71b16250cc50	clothing_kg	0	\N	2025-11-25	\N	2025-11-25 09:37:51.594793+00	2025-11-25 09:37:51.594793+00
6e5c2519-da14-4026-801d-8758a191b682	books_donated	0	\N	2025-11-25	\N	2025-11-25 09:37:51.595223+00	2025-11-25 09:37:51.595223+00
c6e2692f-1c10-4c8b-8fa9-c627b502572a	money_donations	0	\N	2025-11-25	\N	2025-11-25 09:38:55.904381+00	2025-11-25 09:38:55.904381+00
0a41cf33-e943-4c46-baab-5d1dcdd35c2f	volunteer_hours	0	\N	2025-11-25	\N	2025-11-25 09:38:55.905442+00	2025-11-25 09:38:55.905442+00
8b44f79e-2f3b-45ce-8085-453f317e4ebb	rides_completed	0	\N	2025-11-25	\N	2025-11-25 09:38:55.906031+00	2025-11-25 09:38:55.906031+00
c4d22cf6-3a9c-4bfe-ac35-c01d3742976e	events_created	0	\N	2025-11-25	\N	2025-11-25 09:38:55.906581+00	2025-11-25 09:38:55.906581+00
07bb6ba5-0240-42c6-89d6-982bdffc0c9b	active_members	0	\N	2025-11-25	\N	2025-11-25 09:38:55.907022+00	2025-11-25 09:38:55.907022+00
f6c8af12-1396-41ca-9da1-5476f5b218e9	food_kg	0	\N	2025-11-25	\N	2025-11-25 09:38:55.907527+00	2025-11-25 09:38:55.907527+00
499a223c-c04f-4036-ac1b-4ec8a8715c44	clothing_kg	0	\N	2025-11-25	\N	2025-11-25 09:38:55.907972+00	2025-11-25 09:38:55.907972+00
66ea8354-215f-4224-a026-65eaee84e924	books_donated	0	\N	2025-11-25	\N	2025-11-25 09:38:55.908629+00	2025-11-25 09:38:55.908629+00
4e0b230b-e6a3-4840-99d8-634d3026c351	money_donations	0	\N	2025-11-25	\N	2025-11-25 09:39:18.775445+00	2025-11-25 09:39:18.775445+00
af7dba2d-07b8-4a30-b6cc-e015bf254270	volunteer_hours	0	\N	2025-11-25	\N	2025-11-25 09:39:18.776409+00	2025-11-25 09:39:18.776409+00
7247b5f4-208e-48a7-8991-c1fa28adb652	rides_completed	0	\N	2025-11-25	\N	2025-11-25 09:39:18.776838+00	2025-11-25 09:39:18.776838+00
f27c542c-415a-47c6-be74-986b1021e1bf	events_created	0	\N	2025-11-25	\N	2025-11-25 09:39:18.777318+00	2025-11-25 09:39:18.777318+00
35af01c8-cc8a-4726-990c-e9a7ec50d53a	active_members	0	\N	2025-11-25	\N	2025-11-25 09:39:18.777796+00	2025-11-25 09:39:18.777796+00
74eb8537-b6d3-4c43-9112-861ceb4c7824	food_kg	0	\N	2025-11-25	\N	2025-11-25 09:39:18.778213+00	2025-11-25 09:39:18.778213+00
5e6de7cc-dcf2-470f-9fdf-3a8e9be71e24	clothing_kg	0	\N	2025-11-25	\N	2025-11-25 09:39:18.778682+00	2025-11-25 09:39:18.778682+00
038bc3aa-9bd5-4958-8d0a-28e65afccc9d	books_donated	0	\N	2025-11-25	\N	2025-11-25 09:39:18.779338+00	2025-11-25 09:39:18.779338+00
713b22be-bddb-4228-8ff4-4edeb669a6f4	money_donations	0	\N	2025-11-25	\N	2025-11-25 17:15:50.067013+00	2025-11-25 17:15:50.067013+00
dd14e01c-e0e3-46a9-a1de-de3cb8887433	volunteer_hours	0	\N	2025-11-25	\N	2025-11-25 17:15:50.068263+00	2025-11-25 17:15:50.068263+00
bec3393d-ce0b-4111-a2b1-85b548069972	rides_completed	0	\N	2025-11-25	\N	2025-11-25 17:15:50.069017+00	2025-11-25 17:15:50.069017+00
08fd1893-8325-4572-9b4b-382148286fbf	events_created	0	\N	2025-11-25	\N	2025-11-25 17:15:50.069742+00	2025-11-25 17:15:50.069742+00
8570536e-0375-4f54-8e21-b5576c33c428	active_members	0	\N	2025-11-25	\N	2025-11-25 17:15:50.070482+00	2025-11-25 17:15:50.070482+00
a1fcd2e6-f232-4c25-b0ef-203bf66a67fe	food_kg	0	\N	2025-11-25	\N	2025-11-25 17:15:50.071724+00	2025-11-25 17:15:50.071724+00
e56e14d8-ff9e-49fb-a6fd-25356072e9c7	clothing_kg	0	\N	2025-11-25	\N	2025-11-25 17:15:50.073563+00	2025-11-25 17:15:50.073563+00
6bc1536a-2fc4-4204-9321-ec0cc87a2581	books_donated	0	\N	2025-11-25	\N	2025-11-25 17:15:50.074785+00	2025-11-25 17:15:50.074785+00
f6645c15-eebb-46ce-8b0d-56fd5767967a	money_donations	0	\N	2025-11-25	\N	2025-11-25 17:16:37.563113+00	2025-11-25 17:16:37.563113+00
71e82f8f-2400-442f-8d8b-ba9e4b696964	volunteer_hours	0	\N	2025-11-25	\N	2025-11-25 17:16:37.564681+00	2025-11-25 17:16:37.564681+00
758cd4ab-b34f-4ab4-a1e0-b61a9155ed5c	rides_completed	0	\N	2025-11-25	\N	2025-11-25 17:16:37.565627+00	2025-11-25 17:16:37.565627+00
f8be4c23-9e35-4b6e-8432-d4b2739ee38f	events_created	0	\N	2025-11-25	\N	2025-11-25 17:16:37.566521+00	2025-11-25 17:16:37.566521+00
6c04d4fa-fbf6-4133-8586-fd113f8d940d	active_members	0	\N	2025-11-25	\N	2025-11-25 17:16:37.567995+00	2025-11-25 17:16:37.567995+00
88475dac-61da-4501-9e80-848992af98e9	food_kg	0	\N	2025-11-25	\N	2025-11-25 17:16:37.569759+00	2025-11-25 17:16:37.569759+00
6548af20-56b9-45f1-b39f-2508ba78b627	clothing_kg	0	\N	2025-11-25	\N	2025-11-25 17:16:37.570975+00	2025-11-25 17:16:37.570975+00
b6cbc935-a827-4426-8e00-073512214eba	books_donated	0	\N	2025-11-25	\N	2025-11-25 17:16:37.572582+00	2025-11-25 17:16:37.572582+00
\.


--
-- Data for Name: conversation_metadata; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.conversation_metadata (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: donation_categories; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.donation_categories (id, slug, name_he, name_en, description_he, description_en, icon, color, is_active, sort_order, created_at, updated_at) FROM stdin;
e2ff5503-bbee-4760-b52b-f6f46650ce30	money	כסף	Money	\N	\N	💰	#4CAF50	t	1	2025-11-25 09:29:39.968375+00	2025-11-25 17:16:37.531289+00
e29b7c53-264f-43eb-8d6e-3f391d968cc5	trump	טרמפים	Rides	\N	\N	🚗	#2196F3	t	2	2025-11-25 09:29:39.969679+00	2025-11-25 17:16:37.536544+00
73068b41-3ff0-4629-b034-ffe28e89ff45	knowledge	ידע	Knowledge	\N	\N	📚	#9C27B0	t	3	2025-11-25 09:29:39.970248+00	2025-11-25 17:16:37.538139+00
5d6df1f5-ab73-416f-a039-92d1ae5dc382	time	זמן	Time	\N	\N	⏰	#FF9800	t	4	2025-11-25 09:29:39.970661+00	2025-11-25 17:16:37.539719+00
17580580-4369-4b15-8136-53705bc376ee	food	אוכל	Food	\N	\N	🍞	#8BC34A	t	5	2025-11-25 09:29:39.971127+00	2025-11-25 17:16:37.541541+00
e8b999c2-609f-47da-8743-2e40e8c70832	clothes	בגדים	Clothes	\N	\N	👕	#03A9F4	t	6	2025-11-25 09:29:39.971733+00	2025-11-25 17:16:37.544876+00
54904dd9-3744-4d84-9708-29d23e7c3eb9	books	ספרים	Books	\N	\N	📖	#607D8B	t	7	2025-11-25 09:29:39.97223+00	2025-11-25 17:16:37.547629+00
9ec030e0-92b0-4a46-a264-923921290b5d	furniture	רהיטים	Furniture	\N	\N	🪑	#795548	t	8	2025-11-25 09:29:39.97289+00	2025-11-25 17:16:37.550215+00
bd195391-1d71-424f-bd7e-f860eb50b4fd	medical	רפואה	Medical	\N	\N	🏥	#F44336	t	9	2025-11-25 09:29:39.97332+00	2025-11-25 17:16:37.552794+00
3b7f285e-6ae9-46d5-b918-9712f2d90568	animals	חיות	Animals	\N	\N	🐾	#4CAF50	t	10	2025-11-25 09:29:39.973899+00	2025-11-25 17:16:37.554033+00
ecf5d320-f9f0-4eb4-8974-7d2af31bc0a3	housing	דיור	Housing	\N	\N	🏠	#FF5722	t	11	2025-11-25 09:29:39.974288+00	2025-11-25 17:16:37.555026+00
8405e7fb-e591-48b2-9474-bc75da059902	support	תמיכה	Support	\N	\N	💝	#E91E63	t	12	2025-11-25 09:29:39.974684+00	2025-11-25 17:16:37.556242+00
7f53a3fa-bba7-4f56-8523-418c1c6b0596	education	חינוך	Education	\N	\N	🎓	#3F51B5	t	13	2025-11-25 09:29:39.975019+00	2025-11-25 17:16:37.557444+00
44be4128-6803-498a-b185-89fdaa7f0b69	environment	סביבה	Environment	\N	\N	🌱	#4CAF50	t	14	2025-11-25 09:29:39.975386+00	2025-11-25 17:16:37.560273+00
4accce4f-5c20-4fd4-9b96-bdd697e83767	technology	טכנולוגיה	Technology	\N	\N	💻	#009688	t	15	2025-11-25 09:29:39.9759+00	2025-11-25 17:16:37.561832+00
\.


--
-- Data for Name: donations; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.donations (id, donor_id, recipient_id, organization_id, category_id, title, description, amount, currency, type, status, is_recurring, location, images, tags, metadata, expires_at, completed_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: event_attendees; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.event_attendees (id, event_id, user_id, status, registered_at) FROM stdin;
\.


--
-- Data for Name: followers; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.followers (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: following; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.following (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: media; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.media (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: message_reactions; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.message_reactions (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: message_read_receipts; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.message_read_receipts (id, message_id, user_id, read_at) FROM stdin;
\.


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.messages (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.notifications (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: org_applications; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.org_applications (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.organizations (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: posts; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.posts (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: read_receipts; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.read_receipts (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: ride_bookings; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.ride_bookings (id, ride_id, passenger_id, seats_requested, status, message, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: rides; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.rides (id, driver_id, title, from_location, to_location, departure_time, arrival_time, available_seats, price_per_seat, description, requirements, status, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.settings (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: tasks; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.tasks (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: typing_status; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.typing_status (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_activities; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.user_activities (id, user_id, activity_type, activity_data, ip_address, user_agent, created_at) FROM stdin;
\.


--
-- Data for Name: user_profiles; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.user_profiles (id, email, name, phone, avatar_url, bio, karma_points, join_date, is_active, last_active, city, country, interests, roles, posts_count, followers_count, following_count, total_donations_amount, total_volunteer_hours, password_hash, email_verified, settings, created_at, updated_at) FROM stdin;
550e8400-e29b-41d4-a716-446655440000	test@example.com	Test User	\N	\N	\N	0	2025-11-25 09:37:33.4722+00	t	2025-11-25 09:37:33.4722+00	\N	Israel	\N	{user}	0	0	0	0.00	0	\N	f	{"privacy": "public", "language": "he", "dark_mode": false, "notifications_enabled": true}	2025-11-25 09:37:33.4722+00	2025-11-25 17:16:37.57595+00
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.users (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: voice_messages; Type: TABLE DATA; Schema: public; Owner: kc
--

COPY public.voice_messages (user_id, item_id, data, created_at, updated_at) FROM stdin;
\.


--
-- Name: analytics analytics_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.analytics
    ADD CONSTRAINT analytics_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: blocked_users blocked_users_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.blocked_users
    ADD CONSTRAINT blocked_users_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: bookmarks bookmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.bookmarks
    ADD CONSTRAINT bookmarks_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: chat_conversations chat_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chats chats_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: community_events community_events_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.community_events
    ADD CONSTRAINT community_events_pkey PRIMARY KEY (id);


--
-- Name: community_stats community_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.community_stats
    ADD CONSTRAINT community_stats_pkey PRIMARY KEY (id);


--
-- Name: community_stats community_stats_stat_type_city_date_period_key; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.community_stats
    ADD CONSTRAINT community_stats_stat_type_city_date_period_key UNIQUE (stat_type, city, date_period);


--
-- Name: conversation_metadata conversation_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.conversation_metadata
    ADD CONSTRAINT conversation_metadata_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: donation_categories donation_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.donation_categories
    ADD CONSTRAINT donation_categories_pkey PRIMARY KEY (id);


--
-- Name: donation_categories donation_categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.donation_categories
    ADD CONSTRAINT donation_categories_slug_key UNIQUE (slug);


--
-- Name: donations donations_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_pkey PRIMARY KEY (id);


--
-- Name: event_attendees event_attendees_event_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_event_id_user_id_key UNIQUE (event_id, user_id);


--
-- Name: event_attendees event_attendees_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_pkey PRIMARY KEY (id);


--
-- Name: followers followers_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.followers
    ADD CONSTRAINT followers_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: following following_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.following
    ADD CONSTRAINT following_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: message_reactions message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: message_read_receipts message_read_receipts_message_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.message_read_receipts
    ADD CONSTRAINT message_read_receipts_message_id_user_id_key UNIQUE (message_id, user_id);


--
-- Name: message_read_receipts message_read_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.message_read_receipts
    ADD CONSTRAINT message_read_receipts_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: org_applications org_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.org_applications
    ADD CONSTRAINT org_applications_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: read_receipts read_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.read_receipts
    ADD CONSTRAINT read_receipts_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: ride_bookings ride_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.ride_bookings
    ADD CONSTRAINT ride_bookings_pkey PRIMARY KEY (id);


--
-- Name: ride_bookings ride_bookings_ride_id_passenger_id_key; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.ride_bookings
    ADD CONSTRAINT ride_bookings_ride_id_passenger_id_key UNIQUE (ride_id, passenger_id);


--
-- Name: rides rides_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.rides
    ADD CONSTRAINT rides_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: typing_status typing_status_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.typing_status
    ADD CONSTRAINT typing_status_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: user_activities user_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.user_activities
    ADD CONSTRAINT user_activities_pkey PRIMARY KEY (id);


--
-- Name: user_profiles user_profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_email_key UNIQUE (email);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: voice_messages voice_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.voice_messages
    ADD CONSTRAINT voice_messages_pkey PRIMARY KEY (user_id, item_id);


--
-- Name: analytics_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX analytics_data_gin ON public.analytics USING gin (data);


--
-- Name: analytics_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX analytics_item_idx ON public.analytics USING btree (item_id);


--
-- Name: analytics_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX analytics_user_idx ON public.analytics USING btree (user_id);


--
-- Name: blocked_users_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX blocked_users_data_gin ON public.blocked_users USING gin (data);


--
-- Name: blocked_users_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX blocked_users_item_idx ON public.blocked_users USING btree (item_id);


--
-- Name: blocked_users_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX blocked_users_user_idx ON public.blocked_users USING btree (user_id);


--
-- Name: bookmarks_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX bookmarks_data_gin ON public.bookmarks USING gin (data);


--
-- Name: bookmarks_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX bookmarks_item_idx ON public.bookmarks USING btree (item_id);


--
-- Name: bookmarks_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX bookmarks_user_idx ON public.bookmarks USING btree (user_id);


--
-- Name: chats_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX chats_data_gin ON public.chats USING gin (data);


--
-- Name: chats_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX chats_item_idx ON public.chats USING btree (item_id);


--
-- Name: chats_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX chats_user_idx ON public.chats USING btree (user_id);


--
-- Name: conversation_metadata_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX conversation_metadata_data_gin ON public.conversation_metadata USING gin (data);


--
-- Name: conversation_metadata_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX conversation_metadata_item_idx ON public.conversation_metadata USING btree (item_id);


--
-- Name: conversation_metadata_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX conversation_metadata_user_idx ON public.conversation_metadata USING btree (user_id);


--
-- Name: followers_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX followers_data_gin ON public.followers USING gin (data);


--
-- Name: followers_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX followers_item_idx ON public.followers USING btree (item_id);


--
-- Name: followers_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX followers_user_idx ON public.followers USING btree (user_id);


--
-- Name: following_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX following_data_gin ON public.following USING gin (data);


--
-- Name: following_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX following_item_idx ON public.following USING btree (item_id);


--
-- Name: following_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX following_user_idx ON public.following USING btree (user_id);


--
-- Name: idx_chat_conversations_participants; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_chat_conversations_participants ON public.chat_conversations USING gin (participants);


--
-- Name: idx_chat_messages_conversation; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_chat_messages_conversation ON public.chat_messages USING btree (conversation_id, created_at);


--
-- Name: idx_chat_messages_sender; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_chat_messages_sender ON public.chat_messages USING btree (sender_id);


--
-- Name: idx_community_events_date; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_community_events_date ON public.community_events USING btree (event_date);


--
-- Name: idx_community_events_organizer; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_community_events_organizer ON public.community_events USING btree (organizer_id);


--
-- Name: idx_community_events_status; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_community_events_status ON public.community_events USING btree (status);


--
-- Name: idx_community_stats_city; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_community_stats_city ON public.community_stats USING btree (city, date_period);


--
-- Name: idx_community_stats_type; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_community_stats_type ON public.community_stats USING btree (stat_type, date_period);


--
-- Name: idx_donations_category; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_donations_category ON public.donations USING btree (category_id);


--
-- Name: idx_donations_created; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_donations_created ON public.donations USING btree (created_at);


--
-- Name: idx_donations_donor; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_donations_donor ON public.donations USING btree (donor_id);


--
-- Name: idx_donations_location; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_donations_location ON public.donations USING gin (location);


--
-- Name: idx_donations_status; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_donations_status ON public.donations USING btree (status);


--
-- Name: idx_donations_type; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_donations_type ON public.donations USING btree (type);


--
-- Name: idx_rides_created; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_rides_created ON public.rides USING btree (created_at);


--
-- Name: idx_rides_departure; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_rides_departure ON public.rides USING btree (departure_time);


--
-- Name: idx_rides_driver; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_rides_driver ON public.rides USING btree (driver_id);


--
-- Name: idx_rides_from_location; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_rides_from_location ON public.rides USING gin (from_location);


--
-- Name: idx_rides_status; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_rides_status ON public.rides USING btree (status);


--
-- Name: idx_rides_to_location; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_rides_to_location ON public.rides USING gin (to_location);


--
-- Name: idx_user_profiles_active; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_user_profiles_active ON public.user_profiles USING btree (is_active, last_active);


--
-- Name: idx_user_profiles_city; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_user_profiles_city ON public.user_profiles USING btree (city);


--
-- Name: idx_user_profiles_email_lower; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_user_profiles_email_lower ON public.user_profiles USING btree (lower((email)::text));


--
-- Name: idx_user_profiles_roles; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_user_profiles_roles ON public.user_profiles USING gin (roles);


--
-- Name: media_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX media_data_gin ON public.media USING gin (data);


--
-- Name: media_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX media_item_idx ON public.media USING btree (item_id);


--
-- Name: media_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX media_user_idx ON public.media USING btree (user_id);


--
-- Name: message_reactions_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX message_reactions_data_gin ON public.message_reactions USING gin (data);


--
-- Name: message_reactions_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX message_reactions_item_idx ON public.message_reactions USING btree (item_id);


--
-- Name: message_reactions_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX message_reactions_user_idx ON public.message_reactions USING btree (user_id);


--
-- Name: messages_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX messages_data_gin ON public.messages USING gin (data);


--
-- Name: messages_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX messages_item_idx ON public.messages USING btree (item_id);


--
-- Name: messages_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX messages_user_idx ON public.messages USING btree (user_id);


--
-- Name: notifications_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX notifications_data_gin ON public.notifications USING gin (data);


--
-- Name: notifications_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX notifications_item_idx ON public.notifications USING btree (item_id);


--
-- Name: notifications_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX notifications_user_idx ON public.notifications USING btree (user_id);


--
-- Name: org_applications_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX org_applications_data_gin ON public.org_applications USING gin (data);


--
-- Name: org_applications_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX org_applications_item_idx ON public.org_applications USING btree (item_id);


--
-- Name: org_applications_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX org_applications_user_idx ON public.org_applications USING btree (user_id);


--
-- Name: organizations_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX organizations_data_gin ON public.organizations USING gin (data);


--
-- Name: organizations_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX organizations_item_idx ON public.organizations USING btree (item_id);


--
-- Name: organizations_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX organizations_user_idx ON public.organizations USING btree (user_id);


--
-- Name: posts_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX posts_data_gin ON public.posts USING gin (data);


--
-- Name: posts_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX posts_item_idx ON public.posts USING btree (item_id);


--
-- Name: posts_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX posts_user_idx ON public.posts USING btree (user_id);


--
-- Name: read_receipts_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX read_receipts_data_gin ON public.read_receipts USING gin (data);


--
-- Name: read_receipts_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX read_receipts_item_idx ON public.read_receipts USING btree (item_id);


--
-- Name: read_receipts_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX read_receipts_user_idx ON public.read_receipts USING btree (user_id);


--
-- Name: settings_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX settings_data_gin ON public.settings USING gin (data);


--
-- Name: settings_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX settings_item_idx ON public.settings USING btree (item_id);


--
-- Name: settings_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX settings_user_idx ON public.settings USING btree (user_id);


--
-- Name: tasks_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX tasks_data_gin ON public.tasks USING gin (data);


--
-- Name: tasks_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX tasks_item_idx ON public.tasks USING btree (item_id);


--
-- Name: tasks_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX tasks_user_idx ON public.tasks USING btree (user_id);


--
-- Name: typing_status_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX typing_status_data_gin ON public.typing_status USING gin (data);


--
-- Name: typing_status_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX typing_status_item_idx ON public.typing_status USING btree (item_id);


--
-- Name: typing_status_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX typing_status_user_idx ON public.typing_status USING btree (user_id);


--
-- Name: users_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX users_data_gin ON public.users USING gin (data);


--
-- Name: users_email_lower_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX users_email_lower_idx ON public.users USING btree (lower((data ->> 'email'::text)));


--
-- Name: users_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX users_item_idx ON public.users USING btree (item_id);


--
-- Name: users_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX users_user_idx ON public.users USING btree (user_id);


--
-- Name: voice_messages_data_gin; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX voice_messages_data_gin ON public.voice_messages USING gin (data);


--
-- Name: voice_messages_item_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX voice_messages_item_idx ON public.voice_messages USING btree (item_id);


--
-- Name: voice_messages_user_idx; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX voice_messages_user_idx ON public.voice_messages USING btree (user_id);


--
-- PostgreSQL database dump complete
--

\unrestrict vAC8svFKPPttIoe9bgK9MiBKmC7nzTp1fz9f16i0aqkcia6NpLNIi2JQYQEEieT

