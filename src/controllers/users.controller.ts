// File overview:
// - Purpose: Users API for register/login (relational), get/update profile, list users, activities/stats, and follow/unfollow.
// - Reached from: Routes under '/api/users'.
// - Provides: Endpoints for CRUD-like operations and analytics; uses Redis caching for profiles/lists.
// - Storage: `user_profiles`, `user_follows`, `user_activities` (and joins to donations/rides).

// TODO: CRITICAL - This file is too long (509 lines). Split into multiple services:
//   - UserService for business logic
//   - UserProfileService for profile operations  
//   - UserStatsService for analytics
//   - UserFollowService for follow/unfollow logic
// TODO: Add comprehensive DTO validation for all endpoints
// TODO: Implement proper pagination with cursor-based approach instead of offset
// TODO: Add comprehensive error handling with proper HTTP status codes
// TODO: Standardize response format across all endpoints
// TODO: Add proper database constraint validation and conflict handling
// TODO: Implement soft deletes instead of hard deletes where applicable
// TODO: Add comprehensive logging and monitoring
// TODO: Add unit and integration tests for all endpoints
// TODO: Optimize database queries - many N+1 query problems
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { RedisCacheService } from '../redis/redis-cache.service';
import * as argon2 from 'argon2';

@Controller('api/users')
export class UsersController {
  // TODO: Move constants to a dedicated constants file
  // TODO: Make cache TTL configurable through environment variables
  // TODO: Implement different TTL values for different types of data
  private readonly CACHE_TTL = 15 * 60; // 15 minutes

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly redisCache: RedisCacheService,
  ) {}


  @Post('register')
  async registerUser(@Body() userData: any) {
    // TODO: Replace 'any' with proper DTO interface
    // TODO: Add comprehensive input validation (email format, password strength)
    // TODO: Add rate limiting to prevent spam registrations
    // TODO: Add email verification flow before account activation
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const normalizedEmail = userData.email.toLowerCase().trim();
      
      // Check if user already exists in users table
      const { rows: existingUsers } = await client.query(
        `SELECT user_id FROM users WHERE LOWER(data->>'email') = LOWER($1) LIMIT 1`,
        [normalizedEmail]
      );

      if (existingUsers.length > 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'User already exists' };
      }

      // Hash password if provided
      let passwordHash = null;
      if (userData.password) {
        passwordHash = await argon2.hash(userData.password);
      }

      const userId = normalizedEmail; // Use email as stable user ID
      const nowIso = new Date().toISOString();
      const userDataJson = {
        id: userId,
        email: normalizedEmail,
        name: userData.name || normalizedEmail.split('@')[0],
        phone: userData.phone || '+9720000000',
        avatar: userData.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name || 'User')}&background=random`,
        bio: userData.bio || 'משתמש חדש בקארמה קומיוניטי',
        karmaPoints: 0,
        joinDate: nowIso,
        isActive: true,
        lastActive: nowIso,
        location: { 
          city: userData.city || 'ישראל', 
          country: userData.country || 'IL' 
        },
        interests: userData.interests || [],
        roles: ['user'],
        postsCount: 0,
        followersCount: 0,
        followingCount: 0,
        passwordHash,
        emailVerified: false,
        settings: userData.settings || {
          "language": "he",
          "dark_mode": false,
          "notifications_enabled": true,
          "privacy": "public"
        }
      };

      // Insert user into users table (the real table)
      await client.query(`
        INSERT INTO users (user_id, item_id, data, created_at, updated_at)
        VALUES ($1, $2, $3::jsonb, NOW(), NOW())
        ON CONFLICT (user_id, item_id)
        DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      `, [userId, userId, userDataJson]);

      await client.query('COMMIT');

      // Clear statistics cache when new user is registered
      // This ensures totalUsers and other user-related stats are refreshed immediately
      await this.redisCache.clearStatsCaches();

      // Return user data in the expected format
      const user = {
        id: userId,
        email: normalizedEmail,
        name: userDataJson.name,
        phone: userDataJson.phone,
        avatar_url: userDataJson.avatar,
        bio: userDataJson.bio,
        karma_points: 0,
        join_date: nowIso,
        is_active: true,
        last_active: nowIso,
        city: userDataJson.location.city,
        country: userDataJson.location.country,
        interests: userDataJson.interests,
        roles: userDataJson.roles,
        posts_count: 0,
        followers_count: 0,
        following_count: 0,
        total_donations_amount: 0,
        total_volunteer_hours: 0,
        email_verified: false,
        settings: userDataJson.settings
      };

      return { success: true, data: user };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Register user error:', error);
      return { success: false, error: 'Failed to register user' };
    } finally {
      client.release();
    }
  }

  @Post('login')
  async loginUser(@Body() loginData: any) {
    try {
      const normalizedEmail = loginData.email.toLowerCase().trim();
      
      // Use the real users table
      const { rows } = await this.pool.query(
        `SELECT user_id, data FROM users WHERE LOWER(data->>'email') = LOWER($1) LIMIT 1`,
        [normalizedEmail]
      );

      if (rows.length === 0) {
        return { success: false, error: 'User not found' };
      }

      const userData = rows[0].data;
      const userId = rows[0].user_id;

      // Verify password if provided
      if (loginData.password && userData.passwordHash) {
        const isValid = await argon2.verify(userData.passwordHash, loginData.password);
        if (!isValid) {
          return { success: false, error: 'Invalid password' };
        }
      }

      // Update last active
      const nowIso = new Date().toISOString();
      userData.lastActive = nowIso;
      await this.pool.query(
        `UPDATE users SET data = $1::jsonb, updated_at = NOW() WHERE user_id = $2 AND item_id = $3`,
        [userData, userId, userId]
      );

      // Return user data in the expected format
      const userResponse = {
        id: userId,
        email: userData.email,
        name: userData.name,
        phone: userData.phone,
        avatar_url: userData.avatar,
        bio: userData.bio || '',
        karma_points: userData.karmaPoints || 0,
        join_date: userData.joinDate || rows[0].created_at,
        is_active: userData.isActive !== false,
        last_active: nowIso,
        city: userData.location?.city || '',
        country: userData.location?.country || 'Israel',
        interests: userData.interests || [],
        roles: userData.roles || ['user'],
        posts_count: userData.postsCount || 0,
        followers_count: userData.followersCount || 0,
        following_count: userData.followingCount || 0,
        total_donations_amount: 0,
        total_volunteer_hours: 0,
        email_verified: userData.emailVerified || false,
        settings: userData.settings || {}
      };

      return { success: true, data: userResponse };
    } catch (error) {
      console.error('Login user error:', error);
      return { success: false, error: 'Login failed' };
    }
  }

  @Get(':id')
  async getUserById(@Param('id') id: string) {
    const cacheKey = `user_profile_${id}`;
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    // Use the real users table (not user_profiles)
    // Support both UUID and email/user_id lookups
    const { rows } = await this.pool.query(`
      SELECT 
        user_id as id,
        data->>'email' as email,
        COALESCE(data->>'name', 'ללא שם') as name,
        data->>'phone' as phone,
        COALESCE(data->>'avatar', '') as avatar_url,
        COALESCE(data->>'bio', '') as bio,
        COALESCE((data->>'karmaPoints')::integer, 0) as karma_points,
        COALESCE((data->>'joinDate')::timestamptz, created_at) as join_date,
        COALESCE((data->>'isActive')::boolean, true) as is_active,
        COALESCE((data->>'lastActive')::timestamptz, updated_at) as last_active,
        COALESCE(data->'location'->>'city', '') as city,
        COALESCE(data->'location'->>'country', 'Israel') as country,
        COALESCE(
          CASE 
            WHEN data->'interests' IS NULL OR data->'interests' = 'null'::jsonb 
            THEN ARRAY[]::text[]
            WHEN jsonb_typeof(data->'interests') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(data->'interests'))
            ELSE ARRAY[]::text[]
          END,
          ARRAY[]::text[]
        ) as interests,
        COALESCE(
          CASE 
            WHEN data->'roles' IS NULL OR data->'roles' = 'null'::jsonb 
            THEN ARRAY['user']::text[]
            WHEN jsonb_typeof(data->'roles') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(data->'roles'))
            ELSE ARRAY['user']::text[]
          END,
          ARRAY['user']::text[]
        ) as roles,
        COALESCE((data->>'postsCount')::integer, 0) as posts_count,
        COALESCE((data->>'followersCount')::integer, 0) as followers_count,
        COALESCE((data->>'followingCount')::integer, 0) as following_count,
        0 as total_donations_amount,
        0 as total_volunteer_hours,
        COALESCE((data->>'emailVerified')::boolean, false) as email_verified,
        COALESCE(data->'settings', '{}'::jsonb) as settings
      FROM users 
      WHERE user_id = $1 
         OR LOWER(data->>'email') = LOWER($1)
         OR data->>'googleId' = $1
         OR data->>'id' = $1
      LIMIT 1
    `, [id]);

    if (rows.length === 0) {
      return { success: false, error: 'User not found' };
    }

    const user = rows[0];
    await this.redisCache.set(cacheKey, user, this.CACHE_TTL);

    return { success: true, data: user };
  }

  @Put(':id')
  async updateUser(@Param('id') id: string, @Body() updateData: any) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get existing user data
      const { rows: existingRows } = await client.query(`
        SELECT user_id, item_id, data FROM users 
        WHERE user_id = $1 
           OR LOWER(data->>'email') = LOWER($1)
           OR data->>'googleId' = $1
           OR data->>'id' = $1
        LIMIT 1
      `, [id]);

      if (existingRows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'User not found' };
      }

      const existingData = existingRows[0].data;
      const userId = existingRows[0].user_id;
      const itemId = existingRows[0].item_id;

      // Hash new password if provided
      if (updateData.password) {
        existingData.passwordHash = await argon2.hash(updateData.password);
      }

      // Update user data
      if (updateData.name) existingData.name = updateData.name;
      if (updateData.phone !== undefined) existingData.phone = updateData.phone;
      if (updateData.avatar_url) existingData.avatar = updateData.avatar_url;
      if (updateData.bio !== undefined) existingData.bio = updateData.bio;
      if (updateData.city !== undefined) {
        if (!existingData.location) existingData.location = {};
        existingData.location.city = updateData.city;
      }
      if (updateData.country !== undefined) {
        if (!existingData.location) existingData.location = {};
        existingData.location.country = updateData.country;
      }
      if (updateData.interests !== undefined) existingData.interests = updateData.interests;
      if (updateData.settings) existingData.settings = { ...existingData.settings, ...updateData.settings };
      
      existingData.lastActive = new Date().toISOString();

      // Update user in users table
      await client.query(`
        UPDATE users 
        SET data = $1::jsonb, updated_at = NOW()
        WHERE user_id = $2 AND item_id = $3
      `, [existingData, userId, itemId]);

      await client.query('COMMIT');

      // Clear cache
      await this.redisCache.delete(`user_profile_${id}`);
      await this.redisCache.delete(`user_profile_${userId}`);

      // Return user data in the expected format
      const user = {
        id: userId,
        email: existingData.email,
        name: existingData.name,
        phone: existingData.phone,
        avatar_url: existingData.avatar,
        bio: existingData.bio || '',
        karma_points: existingData.karmaPoints || 0,
        join_date: existingData.joinDate || existingRows[0].created_at,
        is_active: existingData.isActive !== false,
        last_active: existingData.lastActive,
        city: existingData.location?.city || '',
        country: existingData.location?.country || 'Israel',
        interests: existingData.interests || [],
        roles: existingData.roles || ['user'],
        posts_count: existingData.postsCount || 0,
        followers_count: existingData.followersCount || 0,
        following_count: existingData.followingCount || 0,
        total_donations_amount: 0,
        total_volunteer_hours: 0,
        email_verified: existingData.emailVerified || false,
        settings: existingData.settings || {}
      };

      return { success: true, data: user };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Update user error:', error);
      return { success: false, error: 'Failed to update user' };
    } finally {
      client.release();
    }
  }

  @Get()
  async getUsers(
    @Query('city') city?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    // TODO: Implement proper cache key structure and versioning
    // TODO: Add cache invalidation strategy when users are updated
    // TODO: Implement cache warming for frequently accessed data
    const cacheKey = `users_list_${city || 'all'}_${search || ''}_${limit || '50'}_${offset || '0'}`;
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    // Unified query: Get all users from both user_profiles and users (legacy) tables
    // טבלה מאוחדת: כל המשתמשים מ-user_profiles ו-users (legacy)
    const params: any[] = [];
    let paramCount = 0;
    
    // Build WHERE conditions for filtering
    let whereConditions = '';
    
    if (city) {
      paramCount++;
      whereConditions += ` AND city ILIKE $${paramCount}`;
      params.push(`%${city}%`);
    }

    if (search) {
      paramCount++;
      whereConditions += ` AND (name ILIKE $${paramCount} OR bio ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    // Build pagination
    let limitClause = '';
    let offsetClause = '';
    
    if (limit) {
      paramCount++;
      limitClause = `LIMIT $${paramCount}`;
      params.push(parseInt(limit));
    } else {
      limitClause = `LIMIT 50`;
    }

    if (offset) {
      paramCount++;
      offsetClause = `OFFSET $${paramCount}`;
      params.push(parseInt(offset));
    }

    // Main query: Get unique users (prefer user_profiles over legacy users)
    const query = `
      WITH all_users AS (
        -- Users from user_profiles (new table) - priority
        SELECT 
          id::text as id,
          COALESCE(name, 'ללא שם') as name,
          COALESCE(avatar_url, '') as avatar_url,
          COALESCE(city, '') as city,
          COALESCE(karma_points, 0) as karma_points,
          COALESCE(last_active, updated_at) as last_active,
          COALESCE(total_donations_amount, 0) as total_donations_amount,
          COALESCE(total_volunteer_hours, 0) as total_volunteer_hours,
          COALESCE(join_date, created_at) as join_date,
          COALESCE(bio, '') as bio,
          LOWER(email) as email_key,
          email,
          is_active,
          created_at,
          1 as priority
        FROM user_profiles
        WHERE email IS NOT NULL AND email <> ''
        
        UNION
        
        -- Users from legacy users table that don't exist in user_profiles
        SELECT 
          user_id as id,
          COALESCE(data->>'name', 'ללא שם') as name,
          COALESCE(data->>'avatar', '') as avatar_url,
          COALESCE(data->'location'->>'city', '') as city,
          COALESCE((data->>'karmaPoints')::integer, 0) as karma_points,
          COALESCE((data->>'lastActive')::timestamptz, updated_at) as last_active,
          0 as total_donations_amount,
          0 as total_volunteer_hours,
          COALESCE((data->>'joinDate')::timestamptz, created_at) as join_date,
          COALESCE(data->>'bio', '') as bio,
          LOWER(data->>'email') as email_key,
          data->>'email' as email,
          COALESCE((data->>'isActive')::boolean, true) as is_active,
          created_at,
          2 as priority
        FROM users
        WHERE 
          data->>'email' IS NOT NULL
          AND LOWER(data->>'email') <> ''
          AND (data->>'isActive' IS NULL OR data->>'isActive' = 'true')
          AND LOWER(data->>'email') NOT IN (
            SELECT LOWER(email) FROM user_profiles WHERE email IS NOT NULL AND email <> ''
          )
      ),
      unique_users AS (
        -- Get one record per email (prefer user_profiles)
        SELECT DISTINCT ON (email_key)
          id,
          name,
          avatar_url,
          city,
          karma_points,
          last_active,
          total_donations_amount,
          total_volunteer_hours,
          join_date,
          bio,
          email,
          is_active,
          created_at
        FROM all_users
        WHERE 1=1${whereConditions}
        ORDER BY email_key, priority ASC, created_at DESC
      )
      SELECT 
        id,
        name,
        avatar_url,
        city,
        karma_points,
        last_active,
        total_donations_amount,
        total_volunteer_hours,
        join_date,
        bio,
        email,
        is_active,
        created_at
      FROM unique_users
      ORDER BY karma_points DESC, last_active DESC, join_date DESC
      ${limitClause}
      ${offsetClause}
    `;

    const { rows } = await this.pool.query(query, params);

    // Log for debugging
    console.log(`[UsersController] getUsers returned ${rows.length} users from unified table`);

    await this.redisCache.set(cacheKey, rows, this.CACHE_TTL);
    return { success: true, data: rows };
  }

  @Get(':id/activities')
  async getUserActivities(@Param('id') userId: string, @Query('limit') limit?: string) {
    const cacheKey = `user_activities_${userId}_${limit || '50'}`;
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    const { rows } = await this.pool.query(`
      SELECT activity_type, activity_data, created_at
      FROM user_activities 
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [userId, parseInt(limit || '50')]);

    await this.redisCache.set(cacheKey, rows, 5 * 60); // 5 minutes
    return { success: true, data: rows };
  }

  @Get(':id/stats')
  async getUserStats(@Param('id') userId: string) {
    const cacheKey = `user_stats_${userId}`;
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    // Get donation stats
    const donationStats = await this.pool.query(`
      SELECT 
        COUNT(*) as total_donations,
        SUM(CASE WHEN type = 'money' THEN amount ELSE 0 END) as total_money_donated,
        COUNT(CASE WHEN type = 'time' THEN 1 END) as volunteer_activities,
        COUNT(CASE WHEN type = 'trump' THEN 1 END) as rides_offered
      FROM donations
      WHERE donor_id = $1
    `, [userId]);

    // Get ride stats
    const rideStats = await this.pool.query(`
      SELECT 
        COUNT(*) as rides_created,
        SUM(available_seats) as total_seats_offered,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_rides
      FROM rides
      WHERE driver_id = $1
    `, [userId]);

    // Get booking stats (as passenger)
    const bookingStats = await this.pool.query(`
      SELECT 
        COUNT(*) as rides_booked,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_bookings
      FROM ride_bookings
      WHERE passenger_id = $1
    `, [userId]);

    const stats = {
      donations: donationStats.rows[0],
      rides: rideStats.rows[0],
      bookings: bookingStats.rows[0]
    };

    await this.redisCache.set(cacheKey, stats, this.CACHE_TTL);
    return { success: true, data: stats };
  }

  @Post(':id/follow')
  async followUser(@Param('id') userId: string, @Body() followData: any) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Insert follow relationship
      await client.query(`
        INSERT INTO user_follows (follower_id, following_id)
        VALUES ($1, $2)
        ON CONFLICT (follower_id, following_id) DO NOTHING
      `, [followData.follower_id, userId]);

      // Update follower counts
      await client.query(`
        UPDATE user_profiles 
        SET followers_count = (
          SELECT COUNT(*) FROM user_follows WHERE following_id = user_profiles.id
        )
        WHERE id = $1
      `, [userId]);

      await client.query(`
        UPDATE user_profiles 
        SET following_count = (
          SELECT COUNT(*) FROM user_follows WHERE follower_id = user_profiles.id
        )
        WHERE id = $1
      `, [followData.follower_id]);

      // Track activity
      await client.query(`
        INSERT INTO user_activities (user_id, activity_type, activity_data)
        VALUES ($1, $2, $3)
      `, [
        followData.follower_id,
        'user_followed',
        JSON.stringify({ followed_user_id: userId })
      ]);

      await client.query('COMMIT');

      // Clear relevant caches
      await this.redisCache.delete(`user_profile_${userId}`);
      await this.redisCache.delete(`user_profile_${followData.follower_id}`);

      return { success: true, message: 'User followed successfully' };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Follow user error:', error);
      return { success: false, error: 'Failed to follow user' };
    } finally {
      client.release();
    }
  }

  @Delete(':id/follow')
  async unfollowUser(@Param('id') userId: string, @Body() unfollowData: any) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Remove follow relationship
      await client.query(`
        DELETE FROM user_follows 
        WHERE follower_id = $1 AND following_id = $2
      `, [unfollowData.follower_id, userId]);

      // Update follower counts
      await client.query(`
        UPDATE user_profiles 
        SET followers_count = (
          SELECT COUNT(*) FROM user_follows WHERE following_id = user_profiles.id
        )
        WHERE id = $1
      `, [userId]);

      await client.query(`
        UPDATE user_profiles 
        SET following_count = (
          SELECT COUNT(*) FROM user_follows WHERE follower_id = user_profiles.id
        )
        WHERE id = $1
      `, [unfollowData.follower_id]);

      await client.query('COMMIT');

      // Clear relevant caches
      await this.redisCache.delete(`user_profile_${userId}`);
      await this.redisCache.delete(`user_profile_${unfollowData.follower_id}`);

      return { success: true, message: 'User unfollowed successfully' };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Unfollow user error:', error);
      return { success: false, error: 'Failed to unfollow user' };
    } finally {
      client.release();
    }
  }

  @Get('stats/summary')
  async getUsersSummary() {
    const cacheKey = 'users_summary_stats';
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    const { rows } = await this.pool.query(`
      WITH all_users AS (
        -- Users from user_profiles
        SELECT 
          email,
          is_active,
          last_active,
          join_date,
          karma_points,
          total_donations_amount
        FROM user_profiles
        WHERE email IS NOT NULL AND email <> ''
        
        UNION
        
        -- Users from legacy users table that don't exist in user_profiles
        SELECT 
          LOWER(data->>'email') as email,
          COALESCE((data->>'isActive')::boolean, true) as is_active,
          COALESCE((data->>'lastActive')::timestamptz, created_at) as last_active,
          COALESCE((data->>'joinDate')::timestamptz, created_at) as join_date,
          COALESCE((data->>'karmaPoints')::integer, 0) as karma_points,
          0 as total_donations_amount
        FROM users
        WHERE data->>'email' IS NOT NULL
          AND LOWER(data->>'email') <> ''
          AND LOWER(data->>'email') NOT IN (
            SELECT LOWER(email) FROM user_profiles WHERE email IS NOT NULL AND email <> ''
          )
      )
      SELECT 
        COUNT(DISTINCT email) as total_users,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_users,
        COUNT(CASE WHEN last_active >= NOW() - INTERVAL '7 days' THEN 1 END) as weekly_active_users,
        COUNT(CASE WHEN last_active >= NOW() - INTERVAL '30 days' THEN 1 END) as monthly_active_users,
        COUNT(CASE WHEN join_date >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as new_users_this_month,
        AVG(karma_points) as avg_karma_points,
        SUM(total_donations_amount) as total_platform_donations
      FROM all_users
    `);

    const stats = rows[0];
    await this.redisCache.set(cacheKey, stats, this.CACHE_TTL);

    return { success: true, data: stats };
  }
}
