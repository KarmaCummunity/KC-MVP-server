--
-- PostgreSQL database dump
--

\restrict bLwxTYf56bWiQz7F5wUtgsg8qYIC1cipTwLSOwDK96GphbAaXRlNn2A9BDiCtE7

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: kc
--

CREATE TABLE public.user_profiles (
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
    updated_at timestamp with time zone DEFAULT now(),
    firebase_uid text NOT NULL
);


ALTER TABLE public.user_profiles OWNER TO kc;

--
-- Data for Name: user_profiles; Type: TABLE DATA; Schema: public; Owner: kc
--

INSERT INTO public.user_profiles VALUES ('test@example.com', 'Test User', NULL, NULL, NULL, 0, '2025-11-25 09:37:33.4722+00', true, '2025-11-25 09:37:33.4722+00', NULL, 'Israel', NULL, '{user}', 0, 0, 0, 0.00, 0, NULL, false, '{"privacy": "public", "language": "he", "dark_mode": false, "notifications_enabled": true}', '2025-11-25 09:37:33.4722+00', '2025-11-25 17:16:37.57595+00', 'temp_55502f40dc8b7c769880b10874abc9d0');
INSERT INTO public.user_profiles VALUES ('direct_test@example.com', 'Direct Test', NULL, NULL, NULL, 0, '2025-12-17 11:24:44.047995+00', true, '2025-12-17 11:24:44.047995+00', NULL, 'Israel', NULL, '{user}', 0, 0, 0, 0.00, 0, 'hash123', false, '{"privacy": "public", "language": "he", "dark_mode": false, "notifications_enabled": true}', '2025-12-17 11:24:44.047995+00', '2025-12-17 11:24:44.047995+00', 'test_uid_123');
INSERT INTO public.user_profiles VALUES ('manual_test@example.com', 'Manual Test', NULL, NULL, NULL, 0, '2025-12-17 11:30:10.688057+00', true, '2025-12-17 11:30:10.688057+00', NULL, 'Israel', NULL, '{user}', 0, 0, 0, 0.00, 0, 'test_hash', false, '{"privacy": "public", "language": "he", "dark_mode": false, "notifications_enabled": true}', '2025-12-17 11:30:10.688057+00', '2025-12-17 11:30:10.688057+00', 'manual_uid_123');
INSERT INTO public.user_profiles VALUES ('another_test@example.com', 'Another', NULL, NULL, NULL, 0, '2025-12-17 11:33:58.160043+00', true, '2025-12-17 11:33:58.160043+00', NULL, 'Israel', NULL, '{user}', 0, 0, 0, 0.00, 0, 'hash', false, '{"privacy": "public", "language": "he", "dark_mode": false, "notifications_enabled": true}', '2025-12-17 11:33:58.160043+00', '2025-12-17 11:33:58.160043+00', 'another_uid');
INSERT INTO public.user_profiles VALUES ('cli_test@example.com', 'CLI Test', NULL, NULL, NULL, 0, '2025-12-17 15:11:08.761933+00', true, '2025-12-17 15:11:08.761933+00', NULL, 'Israel', NULL, '{user}', 0, 0, 0, 0.00, 0, 'hash123', false, '{"privacy": "public", "language": "he", "dark_mode": false, "notifications_enabled": true}', '2025-12-17 15:11:08.761933+00', '2025-12-17 15:11:08.761933+00', 'cli_uid_789');
INSERT INTO public.user_profiles VALUES ('quote_test@ex.com', 'Quote Test', NULL, NULL, NULL, 0, '2025-12-17 15:16:43.448794+00', true, '2025-12-17 15:16:43.448794+00', NULL, 'Israel', NULL, '{user}', 0, 0, 0, 0.00, 0, 'hash456', false, '{"privacy": "public", "language": "he", "dark_mode": false, "notifications_enabled": true}', '2025-12-17 15:16:43.448794+00', '2025-12-17 15:16:43.448794+00', 'quote_uid_456');


--
-- Name: user_profiles user_profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_email_key UNIQUE (email);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: kc
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (firebase_uid);


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
-- Name: idx_user_profiles_firebase_uid; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_user_profiles_firebase_uid ON public.user_profiles USING btree (firebase_uid);


--
-- Name: idx_user_profiles_roles; Type: INDEX; Schema: public; Owner: kc
--

CREATE INDEX idx_user_profiles_roles ON public.user_profiles USING gin (roles);


--
-- PostgreSQL database dump complete
--

\unrestrict bLwxTYf56bWiQz7F5wUtgsg8qYIC1cipTwLSOwDK96GphbAaXRlNn2A9BDiCtE7

