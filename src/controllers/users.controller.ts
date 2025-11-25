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

      // Check if user already exists
      const { rows: existingUsers } = await client.query(
        `SELECT id FROM user_profiles WHERE LOWER(email) = LOWER($1)`,
        [userData.email]
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

      // Insert user
      const { rows } = await client.query(`
        INSERT INTO user_profiles (
          email, name, phone, avatar_url, bio, city, country, 
          interests, password_hash, settings
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, email, name, phone, avatar_url, bio, karma_points, 
                 join_date, city, country, interests, roles, settings
      `, [
        userData.email.toLowerCase().trim(),
        userData.name || userData.email.split('@')[0],
        userData.phone || null,
        userData.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name || 'User')}&background=random`,
        userData.bio || 'משתמש חדש בקארמה קומיוניטי',
        userData.city || null,
        userData.country || 'Israel',
        userData.interests || [],
        passwordHash,
        userData.settings || {
          "language": "he",
          "dark_mode": false,
          "notifications_enabled": true,
          "privacy": "public"
        }
      ]);

      const user = rows[0];

      // Track registration activity
      await client.query(`
        INSERT INTO user_activities (user_id, activity_type, activity_data)
        VALUES ($1, $2, $3)
      `, [
        user.id,
        'user_registered',
        JSON.stringify({ email: user.email, name: user.name })
      ]);

      // Update community stats
      await client.query(`
        INSERT INTO community_stats (stat_type, stat_value, date_period)
        VALUES ('active_members', 1, CURRENT_DATE)
        ON CONFLICT (stat_type, city, date_period) 
        DO UPDATE SET stat_value = community_stats.stat_value + 1, updated_at = NOW()
      `);

      await client.query('COMMIT');

      return { success: true, data: user };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Register user error:', error);
      // TODO: Implement proper error logging with context and stack traces
      // TODO: Return more specific error messages based on error type
      // TODO: Add error monitoring/alerting for registration failures
      return { success: false, error: 'Failed to register user' };
    } finally {
      client.release();
    }
  }

  @Post('login')
  async loginUser(@Body() loginData: any) {
    try {
      const { rows } = await this.pool.query(
        `SELECT * FROM user_profiles WHERE LOWER(email) = LOWER($1)`,
        [loginData.email]
      );

      if (rows.length === 0) {
        return { success: false, error: 'User not found' };
      }

      const user = rows[0];

      // Verify password if provided
      if (loginData.password && user.password_hash) {
        const isValid = await argon2.verify(user.password_hash, loginData.password);
        if (!isValid) {
          return { success: false, error: 'Invalid password' };
        }
      }

      // Update last active
      await this.pool.query(
        `UPDATE user_profiles SET last_active = NOW() WHERE id = $1`,
        [user.id]
      );

      // Track login activity
      await this.pool.query(`
        INSERT INTO user_activities (user_id, activity_type, activity_data)
        VALUES ($1, $2, $3)
      `, [
        user.id,
        'user_login',
        JSON.stringify({ timestamp: new Date().toISOString() })
      ]);

      // Remove password hash from response
      const { password_hash, ...userResponse } = user;

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

    const { rows } = await this.pool.query(`
      SELECT id, email, name, phone, avatar_url, bio, karma_points,
             join_date, is_active, last_active, city, country, interests,
             roles, posts_count, followers_count, following_count,
             total_donations_amount, total_volunteer_hours, email_verified, settings
      FROM user_profiles 
      WHERE id = $1
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

      // Hash new password if provided
      let passwordHash = undefined;
      if (updateData.password) {
        passwordHash = await argon2.hash(updateData.password);
      }

      const { rows } = await client.query(`
        UPDATE user_profiles 
        SET name = COALESCE($1, name),
            phone = COALESCE($2, phone),
            avatar_url = COALESCE($3, avatar_url),
            bio = COALESCE($4, bio),
            city = COALESCE($5, city),
            country = COALESCE($6, country),
            interests = COALESCE($7, interests),
            settings = COALESCE($8, settings),
            password_hash = COALESCE($9, password_hash),
            updated_at = NOW()
        WHERE id = $10
        RETURNING id, email, name, phone, avatar_url, bio, karma_points,
                 join_date, is_active, last_active, city, country, interests,
                 roles, posts_count, followers_count, following_count,
                 total_donations_amount, total_volunteer_hours, email_verified, settings
      `, [
        updateData.name,
        updateData.phone,
        updateData.avatar_url,
        updateData.bio,
        updateData.city,
        updateData.country,
        updateData.interests,
        updateData.settings ? JSON.stringify(updateData.settings) : null,
        passwordHash,
        id
      ]);

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'User not found' };
      }

      const user = rows[0];

      // Track profile update activity
      await client.query(`
        INSERT INTO user_activities (user_id, activity_type, activity_data)
        VALUES ($1, $2, $3)
      `, [
        id,
        'profile_updated',
        JSON.stringify({ fields_updated: Object.keys(updateData) })
      ]);

      await client.query('COMMIT');

      // Clear cache
      await this.redisCache.delete(`user_profile_${id}`);

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

    // Query both user_profiles and users (legacy) tables to get all users
    // Use UNION to combine both sources, excluding duplicates
    let baseQuery = `
      (
        SELECT 
          id::text as id,
          name,
          avatar_url,
          city,
          karma_points,
          last_active,
          total_donations_amount,
          total_volunteer_hours,
          join_date,
          COALESCE(bio, '') as bio
        FROM user_profiles 
        WHERE is_active = true
      )
      UNION
      (
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
          COALESCE(data->>'bio', '') as bio
        FROM users
        WHERE 
          (data->>'isActive' IS NULL OR data->>'isActive' = 'true')
          AND NOT EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.email = users.data->>'email'
          )
      )
    `;
    
    let query = `SELECT * FROM (${baseQuery}) AS all_users WHERE 1=1`;

    const params: any[] = [];
    let paramCount = 0;

    if (city) {
      paramCount++;
      query += ` AND city ILIKE $${paramCount}`;
      params.push(`%${city}%`);
    }

    if (search) {
      paramCount++;
      query += ` AND (name ILIKE $${paramCount} OR bio ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY karma_points DESC, last_active DESC`;

    if (limit) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(parseInt(limit));
    } else {
      query += ` LIMIT 50`;
    }

    if (offset) {
      paramCount++;
      query += ` OFFSET $${paramCount}`;
      params.push(parseInt(offset));
    }

    const { rows } = await this.pool.query(query, params);

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
