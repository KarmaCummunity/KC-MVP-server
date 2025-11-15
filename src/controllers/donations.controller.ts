// File overview:
// - Purpose: Donations API for categories, CRUD, listing, and stats; updates community/user stats and caches.
// - Reached from: Routes under '/api/donations'.
// - Provides: Create/update/delete donation, list with filters, per-user donations, category endpoints, summary stats.
// - Storage: `donations`, `donation_categories`, `user_profiles`, `community_stats`; Redis caches with TTL.

// TODO: CRITICAL - This file is long (292+ lines). Split into specialized services:
//   - DonationsCategoryService for category operations
//   - DonationsService for CRUD operations
//   - DonationsStatsService for analytics
//   - DonationsCacheService for cache management
// TODO: Add comprehensive DTO validation for all endpoints with class-validator
// TODO: Implement proper pagination with cursor-based approach
// TODO: Add comprehensive error handling with proper HTTP status codes
// TODO: Implement proper authorization and access control
// TODO: Add comprehensive logging and monitoring for all operations
// TODO: Remove hardcoded cache TTL and make it configurable
// TODO: Add comprehensive unit tests for all donation operations
// TODO: Implement proper data sanitization and validation
// TODO: Add comprehensive API documentation with Swagger decorators
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { RedisCacheService } from '../redis/redis-cache.service';

@Controller('api/donations')
export class DonationsController {
  // TODO: Move cache TTL to configuration service
  // TODO: Implement different TTL values for different types of data
  // TODO: Add cache invalidation strategies
  private readonly CACHE_TTL = 10 * 60; // 10 minutes

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly redisCache: RedisCacheService,
  ) {}

  @Get('categories')
  async getCategories() {
    const cacheKey = 'donation_categories_all';
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    const { rows } = await this.pool.query(`
      SELECT id, slug, name_he, name_en, description_he, description_en, 
             icon, color, is_active, sort_order
      FROM donation_categories 
      WHERE is_active = true 
      ORDER BY sort_order ASC, name_he ASC
    `);

    await this.redisCache.set(cacheKey, rows, this.CACHE_TTL);
    return { success: true, data: rows };
  }

  @Get('categories/:slug')
  async getCategoryBySlug(@Param('slug') slug: string) {
    const { rows } = await this.pool.query(`
      SELECT * FROM donation_categories WHERE slug = $1 AND is_active = true
    `, [slug]);

    if (rows.length === 0) {
      return { success: false, error: 'Category not found' };
    }

    return { success: true, data: rows[0] };
  }

  @Post()
  async createDonation(@Body() donationData: any) {
    // TODO: Replace 'any' with proper CreateDonationDTO interface
    // TODO: Add comprehensive input validation and sanitization
    // TODO: Add proper authentication and authorization checks
    // TODO: Implement rate limiting for donation creation
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Insert donation
      const { rows } = await client.query(`
        INSERT INTO donations (
          donor_id, recipient_id, organization_id, category_id, 
          title, description, amount, currency, type, status,
          location, images, tags, metadata, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `, [
        donationData.donor_id,
        donationData.recipient_id || null,
        donationData.organization_id || null,
        donationData.category_id,
        donationData.title,
        donationData.description,
        donationData.amount || null,
        donationData.currency || 'ILS',
        donationData.type,
        'active',
        donationData.location ? JSON.stringify(donationData.location) : null,
        donationData.images || [],
        donationData.tags || [],
        donationData.metadata ? JSON.stringify(donationData.metadata) : null,
        donationData.expires_at || null
      ]);

      const donation = rows[0];

      // Update user stats
      if (donationData.type === 'money' && donationData.amount) {
        await client.query(`
          UPDATE user_profiles 
          SET total_donations_amount = total_donations_amount + $1,
              updated_at = NOW()
          WHERE id = $2
        `, [donationData.amount, donationData.donor_id]);
      }

      // Update community stats
      await this.updateCommunityStats(client, donationData.type, donationData.amount || 1);

      // Track user activity
      await client.query(`
        INSERT INTO user_activities (user_id, activity_type, activity_data)
        VALUES ($1, $2, $3)
      `, [
        donationData.donor_id,
        'donation_created',
        JSON.stringify({ donation_id: donation.id, type: donationData.type, amount: donationData.amount })
      ]);

      await client.query('COMMIT');

      // Clear relevant caches
      await this.clearDonationCaches();
      await this.clearCommunityStatsCaches();

      return { success: true, data: donation };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Create donation error:', error);
      return { success: false, error: 'Failed to create donation' };
    } finally {
      client.release();
    }
  }

  @Get()
  async getDonations(
    @Query('type') type?: string,
    @Query('category') category?: string,
    @Query('city') city?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string
  ) {
    const cacheKey = `donations_${type || 'all'}_${category || 'all'}_${city || 'all'}_${status || 'active'}_${limit || '50'}_${offset || '0'}_${search || ''}`;
    
    // Try cache first
    const cached = await this.redisCache.get(cacheKey);
    if (cached) {
      return { success: true, data: cached };
    }

    let query = `
      SELECT d.*, dc.name_he as category_name, dc.icon as category_icon,
             up.name as donor_name, up.city as donor_city, up.avatar_url as donor_avatar
      FROM donations d
      LEFT JOIN donation_categories dc ON d.category_id = dc.id
      LEFT JOIN user_profiles up ON d.donor_id = up.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramCount = 0;

    if (type) {
      paramCount++;
      query += ` AND d.type = $${paramCount}`;
      params.push(type);
    }

    if (category) {
      paramCount++;
      query += ` AND dc.slug = $${paramCount}`;
      params.push(category);
    }

    if (city) {
      paramCount++;
      query += ` AND (d.location->>'city' = $${paramCount} OR up.city = $${paramCount})`;
      params.push(city);
    }

    if (status) {
      paramCount++;
      query += ` AND d.status = $${paramCount}`;
      params.push(status);
    } else {
      query += ` AND d.status = 'active'`;
    }

    if (search) {
      paramCount++;
      query += ` AND (d.title ILIKE $${paramCount} OR d.description ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY d.created_at DESC`;

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

    // Cache for 5 minutes
    await this.redisCache.set(cacheKey, rows, 5 * 60);

    return { success: true, data: rows };
  }

  @Get(':id')
  async getDonationById(@Param('id') id: string) {
    const { rows } = await this.pool.query(`
      SELECT d.*, dc.name_he as category_name, dc.icon as category_icon,
             up.name as donor_name, up.city as donor_city, up.avatar_url as donor_avatar,
             up.phone as donor_phone, up.email as donor_email
      FROM donations d
      LEFT JOIN donation_categories dc ON d.category_id = dc.id
      LEFT JOIN user_profiles up ON d.donor_id = up.id
      WHERE d.id = $1
    `, [id]);

    if (rows.length === 0) {
      return { success: false, error: 'Donation not found' };
    }

    return { success: true, data: rows[0] };
  }

  @Put(':id')
  async updateDonation(@Param('id') id: string, @Body() updateData: any) {
    const { rows } = await this.pool.query(`
      UPDATE donations 
      SET title = COALESCE($1, title),
          description = COALESCE($2, description),
          amount = COALESCE($3, amount),
          status = COALESCE($4, status),
          location = COALESCE($5, location),
          images = COALESCE($6, images),
          tags = COALESCE($7, tags),
          metadata = COALESCE($8, metadata),
          expires_at = COALESCE($9, expires_at),
          updated_at = NOW()
      WHERE id = $10
      RETURNING *
    `, [
      updateData.title,
      updateData.description,
      updateData.amount,
      updateData.status,
      updateData.location ? JSON.stringify(updateData.location) : null,
      updateData.images,
      updateData.tags,
      updateData.metadata ? JSON.stringify(updateData.metadata) : null,
      updateData.expires_at,
      id
    ]);

    if (rows.length === 0) {
      return { success: false, error: 'Donation not found' };
    }

    await this.clearDonationCaches();
    return { success: true, data: rows[0] };
  }

  @Delete(':id')
  async deleteDonation(@Param('id') id: string) {
    // First check if donation exists
    const { rows } = await this.pool.query(`
      SELECT id, status FROM donations WHERE id = $1
    `, [id]);

    if (rows.length === 0) {
      return { success: false, error: 'Donation not found' };
    }

    // Delete from database
    const { rowCount } = await this.pool.query(`
      DELETE FROM donations WHERE id = $1
    `, [id]);

    if (rowCount === 0) {
      return { success: false, error: 'Failed to delete donation' };
    }

    // Clear all related caches
    await this.clearDonationCaches();
    await this.clearCommunityStatsCaches();

    return { success: true, message: 'Donation deleted successfully' };
  }

  @Get('user/:userId')
  async getUserDonations(@Param('userId') userId: string) {
    const cacheKey = `user_donations_${userId}`;
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    const { rows } = await this.pool.query(`
      SELECT d.*, dc.name_he as category_name, dc.icon as category_icon
      FROM donations d
      LEFT JOIN donation_categories dc ON d.category_id = dc.id
      WHERE d.donor_id = $1
      ORDER BY d.created_at DESC
    `, [userId]);

    await this.redisCache.set(cacheKey, rows, this.CACHE_TTL);
    return { success: true, data: rows };
  }

  @Get('stats/summary')
  async getDonationStats() {
    const cacheKey = 'donation_stats_summary';
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    const { rows } = await this.pool.query(`
      SELECT 
        COUNT(*) as total_donations,
        COUNT(DISTINCT donor_id) as unique_donors,
        SUM(CASE WHEN type = 'money' THEN amount ELSE 0 END) as total_money,
        COUNT(CASE WHEN type = 'time' THEN 1 END) as time_donations,
        COUNT(CASE WHEN type = 'trump' THEN 1 END) as ride_donations,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_donations,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_donations
      FROM donations
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `);

    const stats = rows[0];
    await this.redisCache.set(cacheKey, stats, this.CACHE_TTL);
    return { success: true, data: stats };
  }

  private async updateCommunityStats(client: any, type: string, amount: number) {
    const statType = type === 'money' ? 'money_donations' : 
                    type === 'time' ? 'volunteer_hours' :
                    type === 'trump' ? 'rides_completed' : 'other_donations';

    await client.query(`
      INSERT INTO community_stats (stat_type, stat_value, date_period)
      VALUES ($1, $2, CURRENT_DATE)
      ON CONFLICT (stat_type, city, date_period) 
      DO UPDATE SET stat_value = community_stats.stat_value + $2, updated_at = NOW()
    `, [statType, amount]);
  }

  private async clearDonationCaches() {
    const keys = await this.redisCache.getKeys('donations_*');
    const userKeys = await this.redisCache.getKeys('user_donations_*');
    const statsKeys = await this.redisCache.getKeys('donation_stats_*');
    
    const allKeys = [...keys, ...userKeys, ...statsKeys, 'donation_categories_all'];
    
    for (const key of allKeys) {
      await this.redisCache.delete(key);
    }
  }

  private async clearCommunityStatsCaches() {
    const patterns = [
      'community_stats_*',
      'community_trends_*',
      'dashboard_stats',
      'real_time_stats',
    ];
    for (const pattern of patterns) {
      const keys = await this.redisCache.getKeys(pattern);
      for (const key of keys) {
        await this.redisCache.delete(key);
      }
    }
  }
}
