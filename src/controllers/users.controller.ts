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
  ) { }


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

      // Check if user already exists in user_profiles table
      const { rows: existingUsers } = await client.query(
        `SELECT id FROM user_profiles WHERE LOWER(email) = LOWER($1) LIMIT 1`,
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

      const nowIso = new Date().toISOString();

      // Insert user into user_profiles table with UUID
      // Include firebase_uid if provided (for Firebase authentication)
      const { rows: newUser } = await client.query(`
        INSERT INTO user_profiles (
          email, name, phone, avatar_url, bio, password_hash,
          karma_points, join_date, is_active, last_active,
          city, country, interests, roles, email_verified, settings, firebase_uid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text[], $14::text[], $15, $16::jsonb, $17)
        RETURNING id
      `, [
        normalizedEmail,
        userData.name || normalizedEmail.split('@')[0],
        userData.phone || '+9720000000',
        userData.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name || 'User')}&background=random`,
        userData.bio || 'משתמש חדש בקארמה קומיוניטי',
        passwordHash,
        0, // karma_points
        nowIso, // join_date
        true, // is_active
        nowIso, // last_active
        userData.city || 'ישראל', // city
        userData.country || 'Israel', // country
        userData.interests || [], // interests
        ['user'], // roles
        false, // email_verified
        JSON.stringify(userData.settings || {
          "language": "he",
          "dark_mode": false,
          "notifications_enabled": true,
          "privacy": "public"
        }), // settings
        userData.firebase_uid || userData.id || null // firebase_uid - use id if it's a Firebase UID
      ]);

      const userId = newUser[0].id;

      await client.query('COMMIT');

      // Clear statistics cache when new user is registered
      // This ensures totalUsers and other user-related stats are refreshed immediately
      await this.redisCache.clearStatsCaches();

      // Fetch the created user to return full data
      const { rows: createdUser } = await client.query(
        `SELECT id, email, name, phone, avatar_url, bio, city, country, interests, roles, settings, created_at
         FROM user_profiles WHERE id = $1`,
        [userId]
      );

      // Return user data in the expected format
      const user = {
        id: createdUser[0].id,
        email: createdUser[0].email,
        name: createdUser[0].name,
        phone: createdUser[0].phone,
        avatar_url: createdUser[0].avatar_url,
        bio: createdUser[0].bio || '',
        karma_points: 0,
        join_date: createdUser[0].created_at,
        is_active: true,
        last_active: nowIso,
        city: createdUser[0].city || '',
        country: createdUser[0].country || 'Israel',
        interests: createdUser[0].interests || [],
        roles: createdUser[0].roles || ['user'],
        posts_count: 0,
        followers_count: 0,
        following_count: 0,
        total_donations_amount: 0,
        total_volunteer_hours: 0,
        email_verified: false,
        settings: createdUser[0].settings || {}
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

      // Use user_profiles table
      const { rows } = await this.pool.query(
        `SELECT id, email, name, phone, avatar_url, bio, password_hash, 
                karma_points, join_date, is_active, last_active,
                city, country, interests, roles, settings, created_at
         FROM user_profiles WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [normalizedEmail]
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
        `UPDATE user_profiles SET last_active = NOW(), updated_at = NOW() WHERE id = $1`,
        [user.id]
      );

      // Return user data in the expected format
      const userResponse = {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        avatar_url: user.avatar_url,
        bio: user.bio || '',
        karma_points: user.karma_points || 0,
        join_date: user.join_date || user.created_at,
        is_active: user.is_active !== false,
        last_active: new Date().toISOString(),
        city: user.city || '',
        country: user.country || 'Israel',
        interests: user.interests || [],
        roles: user.roles || ['user'],
        posts_count: 0, // TODO: Calculate from actual data
        followers_count: 0, // TODO: Calculate from actual data
        following_count: 0, // TODO: Calculate from actual data
        total_donations_amount: 0,
        total_volunteer_hours: 0,
        email_verified: user.email_verified || false,
        settings: user.settings || {}
      };

      return { success: true, data: userResponse };
    } catch (error) {
      console.error('Login user error:', error);
      return { success: false, error: 'Login failed' };
    }
  }

  @Get(':id')
  async getUserById(@Param('id') id: string) {

    // Normalize email to lowercase for consistent lookup
    // This matches the normalization used in auth.controller.ts
    const normalizedId = id.includes('@')
      ? String(id).trim().toLowerCase()
      : id;


    const cacheKey = `user_profile_${normalizedId}`;
    const cached = await this.redisCache.get(cacheKey);

    if (cached) {
      return { success: true, data: cached };
    }

    // Use user_profiles table - support UUID, email, firebase_uid, or google_id lookups

    // Try query with google_id first, if it fails (column doesn't exist), try without it
    let rows: any[];
    try {
      const result = await this.pool.query(`
        SELECT 
          id,
          email,
          COALESCE(name, 'ללא שם') as name,
          phone,
          COALESCE(avatar_url, '') as avatar_url,
          COALESCE(bio, '') as bio,
          COALESCE(karma_points, 0) as karma_points,
          COALESCE(join_date, created_at) as join_date,
          COALESCE(is_active, true) as is_active,
          COALESCE(last_active, updated_at) as last_active,
          COALESCE(city, '') as city,
          COALESCE(country, 'Israel') as country,
          COALESCE(interests, ARRAY[]::TEXT[]) as interests,
          COALESCE(roles, ARRAY['user']::TEXT[]) as roles,
          COALESCE(posts_count, 0) as posts_count,
          COALESCE(followers_count, 0) as followers_count,
          COALESCE(following_count, 0) as following_count,
          0 as total_donations_amount,
          0 as total_volunteer_hours,
          COALESCE(email_verified, false) as email_verified,
          COALESCE(settings, '{}'::jsonb) as settings
        FROM user_profiles 
        WHERE id::text = $1 
           OR LOWER(email) = LOWER($1)
           OR firebase_uid = $1
           OR google_id = $1
        LIMIT 1
      `, [normalizedId]);
      rows = result.rows;
    } catch (error: any) {
      // If google_id column doesn't exist, try without it
      if (error.message && error.message.includes('google_id')) {
        const result = await this.pool.query(`
          SELECT 
            id,
            email,
            COALESCE(name, 'ללא שם') as name,
            phone,
            COALESCE(avatar_url, '') as avatar_url,
            COALESCE(bio, '') as bio,
            COALESCE(karma_points, 0) as karma_points,
            COALESCE(join_date, created_at) as join_date,
            COALESCE(is_active, true) as is_active,
            COALESCE(last_active, updated_at) as last_active,
            COALESCE(city, '') as city,
            COALESCE(country, 'Israel') as country,
            COALESCE(interests, ARRAY[]::TEXT[]) as interests,
            COALESCE(roles, ARRAY['user']::TEXT[]) as roles,
            COALESCE(posts_count, 0) as posts_count,
            COALESCE(followers_count, 0) as followers_count,
            COALESCE(following_count, 0) as following_count,
            0 as total_donations_amount,
            0 as total_volunteer_hours,
            COALESCE(email_verified, false) as email_verified,
            COALESCE(settings, '{}'::jsonb) as settings
          FROM user_profiles 
          WHERE id::text = $1 
             OR LOWER(email) = LOWER($1)
             OR firebase_uid = $1
          LIMIT 1
        `, [normalizedId]);
        rows = result.rows;
      } else {
        throw error;
      }
    }


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

      // Get existing user data from user_profiles
      const { rows: existingRows } = await client.query(`
        SELECT id, email, name, phone, avatar_url, bio, password_hash,
               city, country, interests, settings, roles, created_at
        FROM user_profiles 
        WHERE id::text = $1 OR LOWER(email) = LOWER($1) OR firebase_uid = $1 OR google_id = $1
        LIMIT 1
      `, [id]);

      if (existingRows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'User not found' };
      }

      const existingUser = existingRows[0];
      const userId = existingUser.id;

      // Build update query dynamically
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramCount = 1;

      if (updateData.password) {
        const passwordHash = await argon2.hash(updateData.password);
        updateFields.push(`password_hash = $${paramCount++}`);
        updateValues.push(passwordHash);
      }
      if (updateData.name !== undefined) {
        updateFields.push(`name = $${paramCount++}`);
        updateValues.push(updateData.name);
      }
      if (updateData.phone !== undefined) {
        updateFields.push(`phone = $${paramCount++}`);
        updateValues.push(updateData.phone);
      }
      if (updateData.avatar_url !== undefined) {
        updateFields.push(`avatar_url = $${paramCount++}`);
        updateValues.push(updateData.avatar_url);
      }
      if (updateData.bio !== undefined) {
        updateFields.push(`bio = $${paramCount++}`);
        updateValues.push(updateData.bio);
      }
      if (updateData.city !== undefined) {
        updateFields.push(`city = $${paramCount++}`);
        updateValues.push(updateData.city);
      }
      if (updateData.country !== undefined) {
        updateFields.push(`country = $${paramCount++}`);
        updateValues.push(updateData.country);
      }
      if (updateData.interests !== undefined) {
        updateFields.push(`interests = $${paramCount++}`);
        updateValues.push(updateData.interests);
      }
      if (updateData.settings !== undefined) {
        updateFields.push(`settings = $${paramCount++}::jsonb`);
        updateValues.push(JSON.stringify({ ...existingUser.settings, ...updateData.settings }));
      }
      if (updateData.firebase_uid !== undefined) {
        updateFields.push(`firebase_uid = $${paramCount++}`);
        updateValues.push(updateData.firebase_uid);
      }

      // Always update last_active and updated_at
      updateFields.push(`last_active = NOW()`, `updated_at = NOW()`);

      if (updateFields.length > 2) { // More than just last_active and updated_at
        updateValues.push(userId);
        await client.query(`
          UPDATE user_profiles 
          SET ${updateFields.join(', ')}
          WHERE id = $${paramCount}
        `, updateValues);
      } else {
        // Only update last_active
        await client.query(`
          UPDATE user_profiles 
          SET last_active = NOW(), updated_at = NOW()
          WHERE id = $1
        `, [userId]);
      }

      await client.query('COMMIT');

      // Fetch updated user
      const { rows: updatedRows } = await client.query(`
        SELECT id, email, name, phone, avatar_url, bio, karma_points, join_date,
               is_active, last_active, city, country, interests, roles, 
               posts_count, followers_count, following_count, email_verified, settings, created_at
        FROM user_profiles WHERE id = $1
      `, [userId]);

      // Clear cache to ensure fresh data after update
      await this.redisCache.delete(`user_profile_${id}`);
      await this.redisCache.delete(`user_profile_${userId}`);

      const updatedUser = updatedRows[0];

      // Return user data in the expected format
      const user = {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        phone: updatedUser.phone,
        avatar_url: updatedUser.avatar_url,
        bio: updatedUser.bio || '',
        karma_points: updatedUser.karma_points || 0,
        join_date: updatedUser.join_date || updatedUser.created_at,
        is_active: updatedUser.is_active !== false,
        last_active: updatedUser.last_active,
        city: updatedUser.city || '',
        country: updatedUser.country || 'Israel',
        interests: updatedUser.interests || [],
        roles: updatedUser.roles || ['user'],
        posts_count: updatedUser.posts_count || 0,
        followers_count: updatedUser.followers_count || 0,
        following_count: updatedUser.following_count || 0,
        total_donations_amount: 0,
        total_volunteer_hours: 0,
        email_verified: updatedUser.email_verified || false,
        settings: updatedUser.settings || {}
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

    // Main query: Get users from user_profiles only (legacy users table no longer used)
    const query = `
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
        email,
        is_active,
        created_at
      FROM user_profiles
      WHERE email IS NOT NULL AND email <> ''
        ${whereConditions}
      ORDER BY karma_points DESC, last_active DESC, join_date DESC
      ${limitClause}
      ${offsetClause}
    `;

    const { rows } = await this.pool.query(query, params);

    // Log for debugging
    console.log(`[UsersController] getUsers returned ${rows.length} users from unified table`);

    // Cache for 20 minutes - user lists are relatively static
    await this.redisCache.set(cacheKey, rows, 20 * 60);
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

  /**
   * Get user statistics with partial caching optimization
   * Each statistic type (donations, rides, bookings) is cached separately
   * This allows partial cache hits - if only one stat changes, others remain cached
   * Cache TTL: 15 minutes
   */
  @Get(':id/stats')
  async getUserStats(@Param('id') userId: string) {
    const cacheKey = `user_stats_${userId}`;
    const cached = await this.redisCache.get(cacheKey);

    if (cached) {
      return { success: true, data: cached };
    }

    // Try to get individual cached stats using batch get for better performance
    const donationStatsKey = `user_stats_donations_${userId}`;
    const rideStatsKey = `user_stats_rides_${userId}`;
    const bookingStatsKey = `user_stats_bookings_${userId}`;

    const cachedStats = await this.redisCache.getMultiple([
      donationStatsKey,
      rideStatsKey,
      bookingStatsKey,
    ]);

    let donationStats: any;
    let rideStats: any;
    let bookingStats: any;

    // Get donation stats (from cache or DB)
    if (cachedStats.get(donationStatsKey)) {
      donationStats = { rows: [cachedStats.get(donationStatsKey)] };
    } else {
      const result = await this.pool.query(`
        SELECT 
          COUNT(*) as total_donations,
          SUM(CASE WHEN type = 'money' THEN amount ELSE 0 END) as total_money_donated,
          COUNT(CASE WHEN type = 'time' THEN 1 END) as volunteer_activities,
          COUNT(CASE WHEN type = 'trump' THEN 1 END) as rides_offered
        FROM donations
        WHERE donor_id = $1
      `, [userId]);
      donationStats = result;
      await this.redisCache.set(donationStatsKey, result.rows[0], this.CACHE_TTL);
    }

    // Get ride stats (from cache or DB)
    if (cachedStats.get(rideStatsKey)) {
      rideStats = { rows: [cachedStats.get(rideStatsKey)] };
    } else {
      const result = await this.pool.query(`
        SELECT 
          COUNT(*) as rides_created,
          SUM(available_seats) as total_seats_offered,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_rides
        FROM rides
        WHERE driver_id = $1
      `, [userId]);
      rideStats = result;
      await this.redisCache.set(rideStatsKey, result.rows[0], this.CACHE_TTL);
    }

    // Get booking stats (from cache or DB)
    if (cachedStats.get(bookingStatsKey)) {
      bookingStats = { rows: [cachedStats.get(bookingStatsKey)] };
    } else {
      const result = await this.pool.query(`
        SELECT 
          COUNT(*) as rides_booked,
          COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_bookings
        FROM ride_bookings
        WHERE passenger_id = $1
      `, [userId]);
      bookingStats = result;
      await this.redisCache.set(bookingStatsKey, result.rows[0], this.CACHE_TTL);
    }

    const stats = {
      donations: donationStats.rows[0],
      rides: rideStats.rows[0],
      bookings: bookingStats.rows[0]
    };

    // Cache the combined result
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
      SELECT 
        COUNT(DISTINCT LOWER(email)) as total_users,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_users,
        COUNT(CASE WHEN last_active >= NOW() - INTERVAL '7 days' THEN 1 END) as weekly_active_users,
        COUNT(CASE WHEN last_active >= NOW() - INTERVAL '30 days' THEN 1 END) as monthly_active_users,
        COUNT(CASE WHEN join_date >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as new_users_this_month,
        AVG(karma_points) as avg_karma_points,
        SUM(total_donations_amount) as total_platform_donations
      FROM user_profiles
      WHERE email IS NOT NULL AND email <> ''
    `);

    const stats = rows[0];
    await this.redisCache.set(cacheKey, stats, this.CACHE_TTL);

    return { success: true, data: stats };
  }

  /**
   * Resolve user ID from firebase_uid, google_id, or email to UUID
   * This endpoint is used by the client to get the database UUID when they have Firebase UID or Google ID
   */
  /**
   * Resolve user ID from firebase_uid, google_id, or email to UUID
   * This endpoint is used by the client to get the database UUID when they have Firebase UID or Google ID
   * It performs SMART LINKING: if a user exists by email but lacks the external ID, it updates the record.
   */
  @Post('resolve-id')
  async resolveUserId(@Body() body: { firebase_uid?: string; google_id?: string; email?: string }) {
    const { firebase_uid, google_id, email } = body;

    // Use a clearer logging for debugging
    console.log('🔍 ResolveUserId called with:', { firebase_uid, google_id, email });

    if (!firebase_uid && !google_id && !email) {
      return { success: false, error: 'Must provide firebase_uid, google_id, or email' };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Try to find user by ANY of the identifiers
      // Priorities: Database UUID (not passed here), Firebase UID, Google ID, Email
      let query = `
        SELECT id, email, name, avatar_url, roles, settings, created_at, last_active, firebase_uid, google_id
        FROM user_profiles 
        WHERE false 
      `;
      const params: any[] = [];
      let paramCount = 1;

      if (firebase_uid) {
        query += ` OR firebase_uid = $${paramCount++}`;
        params.push(firebase_uid);
      }
      if (google_id) {
        // Only if google_id column exists (handled by try/catch in query execution if column missing, but we assume it exists from init)
        query += ` OR google_id = $${paramCount++}`;
        params.push(google_id);
      }
      if (email) {
        query += ` OR LOWER(email) = LOWER($${paramCount++})`;
        params.push(email);
      }

      query += ` LIMIT 1`;

      let rows: any[] = [];
      try {
        const result = await client.query(query, params);
        rows = result.rows;
      } catch (err: any) {
        // Fallback if google_id column doesn't exist yet
        if (err.message?.includes('google_id')) {
          console.warn('⚠️ Google ID column missing in resolve-id, retrying without it');
          // Retry without google_id logic
          let fallbackQuery = `SELECT id, email, name, avatar_url, roles, settings, created_at, last_active, firebase_uid FROM user_profiles WHERE false`;
          const fallbackParams: any[] = [];
          let fbCount = 1;
          if (firebase_uid) { fallbackQuery += ` OR firebase_uid = $${fbCount++}`; fallbackParams.push(firebase_uid); }
          if (email) { fallbackQuery += ` OR LOWER(email) = LOWER($${fbCount++})`; fallbackParams.push(email); }

          const fallbackResult = await client.query(fallbackQuery, fallbackParams);
          rows = fallbackResult.rows;
        } else {
          throw err;
        }
      }

      if (rows.length === 0) {
        // User not found - if we have firebase_uid, try to create user from Firebase
        if (firebase_uid) {
          try {
            // Try to get user info from Firebase Admin SDK
            // Note: This requires Firebase Admin SDK to be initialized
            // If not available, we'll just return error
            const admin = require('firebase-admin');
            if (admin.apps.length > 0) {
              try {
                const firebaseUser = await admin.auth().getUser(firebase_uid);
                if (firebaseUser.email) {
                  // Create user in user_profiles
                  const normalizedEmail = firebaseUser.email.toLowerCase().trim();
                  const googleProvider = firebaseUser.providerData?.find(
                    (p: any) => p.providerId === 'google.com'
                  );
                  const googleId = googleProvider?.uid || null;
                  
                  const nowIso = new Date().toISOString();
                  const creationTime = firebaseUser.metadata.creationTime 
                    ? new Date(firebaseUser.metadata.creationTime) 
                    : new Date();
                  const lastSignInTime = firebaseUser.metadata.lastSignInTime
                    ? new Date(firebaseUser.metadata.lastSignInTime)
                    : creationTime;
                  
                  try {
                    const { rows: newUser } = await client.query(
                      `INSERT INTO user_profiles (
                        firebase_uid, google_id, email, name, avatar_url, bio,
                        karma_points, join_date, is_active, last_active,
                        city, country, interests, roles, email_verified, settings
                      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text[], $14::text[], $15, $16::jsonb)
                      RETURNING id, email, name, avatar_url, roles, settings, created_at, last_active`,
                      [
                        firebaseUser.uid,
                        googleId,
                        normalizedEmail,
                        firebaseUser.displayName || normalizedEmail.split('@')[0] || 'User',
                        firebaseUser.photoURL || 'https://i.pravatar.cc/150?img=1',
                        'משתמש חדש בקארמה קומיוניטי',
                        0,
                        creationTime,
                        true,
                        lastSignInTime,
                        'ישראל',
                        'Israel',
                        [],
                        ['user'],
                        firebaseUser.emailVerified || false,
                        JSON.stringify({ 
                          language: 'he', 
                          dark_mode: false, 
                          notifications_enabled: true,
                          privacy: 'public'
                        })
                      ]
                    );
                    await client.query('COMMIT');
                    console.log(`✨ Auto-created user from Firebase: ${normalizedEmail} (${firebaseUser.uid})`);
                    
                    return {
                      success: true,
                      user: {
                        id: newUser[0].id,
                        email: newUser[0].email,
                        name: newUser[0].name,
                        avatar: newUser[0].avatar_url,
                        roles: newUser[0].roles || ['user'],
                        settings: newUser[0].settings || {},
                        createdAt: newUser[0].created_at,
                        lastActive: newUser[0].last_active,
                      },
                    };
                  } catch (insertError: any) {
                    // If google_id column doesn't exist, try without it
                    if (insertError.message && insertError.message.includes('google_id')) {
                      const { rows: newUser } = await client.query(
                        `INSERT INTO user_profiles (
                          firebase_uid, email, name, avatar_url, bio,
                          karma_points, join_date, is_active, last_active,
                          city, country, interests, roles, email_verified, settings
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13::text[], $14, $15::jsonb)
                        RETURNING id, email, name, avatar_url, roles, settings, created_at, last_active`,
                        [
                          firebaseUser.uid,
                          normalizedEmail,
                          firebaseUser.displayName || normalizedEmail.split('@')[0] || 'User',
                          firebaseUser.photoURL || 'https://i.pravatar.cc/150?img=1',
                          'משתמש חדש בקארמה קומיוניטי',
                          0,
                          creationTime,
                          true,
                          lastSignInTime,
                          'ישראל',
                          'Israel',
                          [],
                          ['user'],
                          firebaseUser.emailVerified || false,
                          JSON.stringify({ 
                            language: 'he', 
                            dark_mode: false, 
                            notifications_enabled: true,
                            privacy: 'public'
                          })
                        ]
                      );
                      await client.query('COMMIT');
                      console.log(`✨ Auto-created user from Firebase (without google_id): ${normalizedEmail} (${firebaseUser.uid})`);
                      
                      return {
                        success: true,
                        user: {
                          id: newUser[0].id,
                          email: newUser[0].email,
                          name: newUser[0].name,
                          avatar: newUser[0].avatar_url,
                          roles: newUser[0].roles || ['user'],
                          settings: newUser[0].settings || {},
                          createdAt: newUser[0].created_at,
                          lastActive: newUser[0].last_active,
                        },
                      };
                    } else {
                      throw insertError;
                    }
                  }
                }
              } catch (firebaseError) {
                console.warn('⚠️ Could not fetch user from Firebase Admin SDK:', firebaseError);
                // Continue to return error
              }
            }
          } catch (adminError) {
            // Firebase Admin SDK not available - that's okay, continue
            console.warn('⚠️ Firebase Admin SDK not available for auto-creation');
          }
        }
        
        await client.query('ROLLBACK');
        console.log('❌ User not found for resolution');
        return { success: false, error: 'User not found' };
      }

      const user = rows[0];
      let needsUpdate = false;
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let upCount = 1;

      // 2. Alert on account linking (found by email, but missing external ID)
      if (firebase_uid && user.firebase_uid !== firebase_uid) {
        if (!user.firebase_uid) {
          console.log(`🔗 Linking User ${user.email} to Firebase UID: ${firebase_uid}`);
          updateFields.push(`firebase_uid = $${upCount++}`);
          updateValues.push(firebase_uid);
          needsUpdate = true;
        } else {
          console.warn(`⚠️ Conflict: User ${user.email} has different Firebase UID (${user.firebase_uid}) than provided (${firebase_uid})`);
        }
      }

      if (google_id && user.google_id !== google_id) {
        // Check if row has google_id property (it might not if column missing)
        // We assume if we are here, we want to try updating it.
        if (!user.google_id) {
          console.log(`🔗 Linking User ${user.email} to Google ID: ${google_id}`);
          updateFields.push(`google_id = $${upCount++}`);
          updateValues.push(google_id);
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        try {
          // Append ID for WHERE clause
          updateValues.push(user.id);
          const updateQuery = `
            UPDATE user_profiles 
            SET ${updateFields.join(', ')}, updated_at = NOW()
            WHERE id = $${upCount}
          `;
          await client.query(updateQuery, updateValues);
          console.log('✅ User linked successfully');
        } catch (updateErr) {
          console.error('❌ Failed to link user account:', updateErr);
          // Non-fatal? Maybe. But safer to rollback if linking fails.
          // actually, if we fail to link, we should probably still return the user found by email, 
          // but logging the error is important.
        }
      }

      await client.query('COMMIT');

      // Clear cache for this user
      await this.redisCache.delete(`user_profile_${user.id}`);
      if (user.firebase_uid) await this.redisCache.delete(`user_profile_${user.firebase_uid}`);
      if (user.email) await this.redisCache.delete(`user_profile_${user.email}`);

      return {
        success: true,
        user: {
          id: user.id, // UUID - this is the primary identifier
          email: user.email,
          name: user.name,
          avatar: user.avatar_url,
          roles: user.roles || ['user'],
          settings: user.settings || {},
          createdAt: user.created_at,
          lastActive: user.last_active,
        },
      };

    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('❌ Error in resolveUserId:', error);
      return { success: false, error: error.message || 'Failed to resolve user ID' };
    } finally {
      client.release();
    }
  }
}
