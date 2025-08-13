import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { RedisCacheService } from '../redis/redis-cache.service';

@Controller('api/stats')
export class StatsController {
  private readonly CACHE_TTL = 10 * 60; // 10 minutes for stats

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly redisCache: RedisCacheService,
  ) {}

  @Get('community')
  async getCommunityStats(@Query('city') city?: string, @Query('period') period?: string) {
    const cacheKey = `community_stats_${city || 'global'}_${period || 'current'}`;
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    let dateFilter = '';
    if (period === 'week') {
      dateFilter = "AND date_period >= CURRENT_DATE - INTERVAL '7 days'";
    } else if (period === 'month') {
      dateFilter = "AND date_period >= CURRENT_DATE - INTERVAL '30 days'";
    } else if (period === 'year') {
      dateFilter = "AND date_period >= CURRENT_DATE - INTERVAL '365 days'";
    }

    let query = `
      SELECT 
        stat_type,
        SUM(stat_value) as total_value,
        COUNT(DISTINCT date_period) as days_tracked
      FROM community_stats 
      WHERE 1=1
    `;

    const params: any[] = [];
    if (city) {
      query += ` AND city = $1`;
      params.push(city);
    } else {
      query += ` AND city IS NULL`;
    }

    query += dateFilter;
    query += ` GROUP BY stat_type ORDER BY stat_type`;

    const { rows } = await this.pool.query(query, params);

    // Format response
    const stats: any = {};
    rows.forEach(row => {
      stats[row.stat_type] = {
        value: parseInt(row.total_value),
        days_tracked: parseInt(row.days_tracked)
      };
    });

    // Add computed stats
    await this.addComputedStats(stats, city);

    await this.redisCache.set(cacheKey, stats, this.CACHE_TTL);
    return { success: true, data: stats };
  }

  @Get('community/trends')
  async getCommunityTrends(@Query('stat_type') statType: string, @Query('city') city?: string, @Query('days') days?: string) {
    const cacheKey = `community_trends_${statType}_${city || 'global'}_${days || '30'}`;
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    const daysBack = parseInt(days || '30');
    let query = `
      SELECT date_period, SUM(stat_value) as value
      FROM community_stats 
      WHERE stat_type = $1
        AND date_period >= CURRENT_DATE - INTERVAL '${daysBack} days'
    `;

    const params = [statType];
    if (city) {
      query += ` AND city = $2`;
      params.push(city);
    } else {
      query += ` AND city IS NULL`;
    }

    query += ` GROUP BY date_period ORDER BY date_period ASC`;

    const { rows } = await this.pool.query(query, params);

    await this.redisCache.set(cacheKey, rows, this.CACHE_TTL);
    return { success: true, data: rows };
  }

  @Get('community/cities')
  async getStatsByCity(@Query('stat_type') statType?: string) {
    const cacheKey = `city_stats_${statType || 'all'}`;
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    let query = `
      SELECT 
        city,
        stat_type,
        SUM(stat_value) as total_value
      FROM community_stats 
      WHERE city IS NOT NULL
    `;

    const params: any[] = [];
    if (statType) {
      query += ` AND stat_type = $1`;
      params.push(statType);
    }

    query += ` GROUP BY city, stat_type ORDER BY total_value DESC`;

    const { rows } = await this.pool.query(query, params);

    // Group by city
    const citiesData: any = {};
    rows.forEach(row => {
      if (!citiesData[row.city]) {
        citiesData[row.city] = {};
      }
      citiesData[row.city][row.stat_type] = parseInt(row.total_value);
    });

    await this.redisCache.set(cacheKey, citiesData, this.CACHE_TTL);
    return { success: true, data: citiesData };
  }

  @Post('increment')
  async incrementStat(@Body() statData: any) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Update community stats
      await client.query(`
        INSERT INTO community_stats (stat_type, stat_value, city, date_period)
        VALUES ($1, $2, $3, CURRENT_DATE)
        ON CONFLICT (stat_type, city, date_period) 
        DO UPDATE SET 
          stat_value = community_stats.stat_value + $2,
          updated_at = NOW()
      `, [
        statData.stat_type,
        statData.value || 1,
        statData.city || null
      ]);

      // Clear relevant caches
      await this.clearStatsCaches(statData.stat_type, statData.city);

      await client.query('COMMIT');
      return { success: true, message: 'Stat incremented successfully' };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Increment stat error:', error);
      return { success: false, error: 'Failed to increment stat' };
    } finally {
      client.release();
    }
  }

  @Get('analytics/categories')
  async getCategoryAnalytics() {
    const cacheKey = 'category_analytics';
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    // Get category usage from donations
    const donationsByCategory = await this.pool.query(`
      SELECT 
        dc.slug,
        dc.name_he,
        dc.icon,
        COUNT(d.id) as donation_count,
        SUM(CASE WHEN d.type = 'money' THEN d.amount ELSE 0 END) as total_money,
        COUNT(CASE WHEN d.created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as weekly_count,
        COUNT(CASE WHEN d.created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as monthly_count
      FROM donation_categories dc
      LEFT JOIN donations d ON dc.id = d.category_id
      WHERE dc.is_active = true
      GROUP BY dc.id, dc.slug, dc.name_he, dc.icon
      ORDER BY donation_count DESC
    `);

    // Get category clicks from analytics table (legacy)
    const analyticsData = await this.pool.query(`
      SELECT 
        data->>'categoryId' as category_slug,
        SUM((data->>'count')::integer) as click_count
      FROM analytics 
      WHERE data->>'categoryId' IS NOT NULL
      GROUP BY data->>'categoryId'
    `);

    // Merge data
    const analytics: any = {};
    analyticsData.rows.forEach(row => {
      analytics[row.category_slug] = {
        clicks: parseInt(row.click_count) || 0
      };
    });

    const categoryStats = donationsByCategory.rows.map(category => ({
      ...category,
      clicks: analytics[category.slug]?.clicks || 0,
      engagement_score: (category.donation_count * 10) + (analytics[category.slug]?.clicks || 0)
    }));

    await this.redisCache.set(cacheKey, categoryStats, this.CACHE_TTL);
    return { success: true, data: categoryStats };
  }

  @Get('analytics/users')
  async getUserAnalytics() {
    const cacheKey = 'user_analytics';
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    // User growth
    const userGrowth = await this.pool.query(`
      SELECT 
        DATE(join_date) as date,
        COUNT(*) as new_users
      FROM user_profiles 
      WHERE join_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(join_date)
      ORDER BY date ASC
    `);

    // User activity
    const userActivity = await this.pool.query(`
      SELECT 
        activity_type,
        COUNT(*) as count,
        COUNT(DISTINCT user_id) as unique_users
      FROM user_activities 
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY activity_type
      ORDER BY count DESC
    `);

    // User distribution by city
    const usersByCity = await this.pool.query(`
      SELECT 
        city,
        COUNT(*) as user_count
      FROM user_profiles 
      WHERE city IS NOT NULL AND is_active = true
      GROUP BY city
      ORDER BY user_count DESC
      LIMIT 10
    `);

    const analytics = {
      user_growth: userGrowth.rows,
      user_activity: userActivity.rows,
      users_by_city: usersByCity.rows
    };

    await this.redisCache.set(cacheKey, analytics, this.CACHE_TTL);
    return { success: true, data: analytics };
  }

  @Get('dashboard')
  async getDashboardStats() {
    const cacheKey = 'dashboard_stats';
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    // Key metrics for the last 24 hours, 7 days, and 30 days
    const metrics = await this.pool.query(`
      SELECT 
        -- Today's stats
        COUNT(CASE WHEN d.created_at >= CURRENT_DATE THEN 1 END) as donations_today,
        COUNT(CASE WHEN r.created_at >= CURRENT_DATE THEN 1 END) as rides_today,
        COUNT(CASE WHEN up.join_date >= CURRENT_DATE THEN 1 END) as new_users_today,
        
        -- This week's stats
        COUNT(CASE WHEN d.created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as donations_week,
        COUNT(CASE WHEN r.created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as rides_week,
        COUNT(CASE WHEN up.join_date >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as new_users_week,
        
        -- This month's stats
        COUNT(CASE WHEN d.created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as donations_month,
        COUNT(CASE WHEN r.created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as rides_month,
        COUNT(CASE WHEN up.join_date >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as new_users_month,
        
        -- Total stats
        COUNT(d.id) as total_donations,
        COUNT(r.id) as total_rides,
        COUNT(up.id) as total_users,
        SUM(CASE WHEN d.type = 'money' THEN d.amount ELSE 0 END) as total_money_donated
        
      FROM user_profiles up
      FULL OUTER JOIN donations d ON 1=1
      FULL OUTER JOIN rides r ON 1=1
    `);

    // Active users
    const activeUsers = await this.pool.query(`
      SELECT 
        COUNT(CASE WHEN last_active >= NOW() - INTERVAL '1 day' THEN 1 END) as daily_active,
        COUNT(CASE WHEN last_active >= NOW() - INTERVAL '7 days' THEN 1 END) as weekly_active,
        COUNT(CASE WHEN last_active >= NOW() - INTERVAL '30 days' THEN 1 END) as monthly_active
      FROM user_profiles
      WHERE is_active = true
    `);

    // Top categories
    const topCategories = await this.pool.query(`
      SELECT 
        dc.name_he,
        dc.icon,
        COUNT(d.id) as donation_count
      FROM donation_categories dc
      LEFT JOIN donations d ON dc.id = d.category_id
      WHERE dc.is_active = true
      GROUP BY dc.id, dc.name_he, dc.icon
      ORDER BY donation_count DESC
      LIMIT 5
    `);

    const dashboard = {
      metrics: metrics.rows[0],
      active_users: activeUsers.rows[0],
      top_categories: topCategories.rows
    };

    await this.redisCache.set(cacheKey, dashboard, 5 * 60); // 5 minutes cache
    return { success: true, data: dashboard };
  }

  @Get('real-time')
  async getRealTimeStats() {
    // This endpoint provides frequently updated stats with short cache
    const cacheKey = 'real_time_stats';
    const cached = await this.redisCache.get(cacheKey);
    
    if (cached) {
      return { success: true, data: cached };
    }

    // Last hour's activity
    const recentActivity = await this.pool.query(`
      SELECT 
        activity_type,
        COUNT(*) as count
      FROM user_activities 
      WHERE created_at >= NOW() - INTERVAL '1 hour'
      GROUP BY activity_type
    `);

    // Current active donations and rides
    const currentActive = await this.pool.query(`
      SELECT 
        COUNT(CASE WHEN d.status = 'active' THEN 1 END) as active_donations,
        COUNT(CASE WHEN r.status = 'active' THEN 1 END) as active_rides,
        COUNT(CASE WHEN up.last_active >= NOW() - INTERVAL '5 minutes' THEN 1 END) as users_online
      FROM user_profiles up
      FULL OUTER JOIN donations d ON 1=1
      FULL OUTER JOIN rides r ON 1=1
    `);

    const realTimeData = {
      recent_activity: recentActivity.rows,
      current_active: currentActive.rows[0],
      last_updated: new Date().toISOString()
    };

    await this.redisCache.set(cacheKey, realTimeData, 60); // 1 minute cache
    return { success: true, data: realTimeData };
  }

  private async addComputedStats(stats: any, city?: string) {
    // Calculate derived statistics
    const totalDonations = (stats.money_donations?.value || 0) + 
                          (stats.volunteer_hours?.value || 0) + 
                          (stats.rides_completed?.value || 0);

    const activeMembers = await this.pool.query(`
      SELECT COUNT(DISTINCT id) as count
      FROM user_profiles 
      WHERE is_active = true 
        AND last_active >= NOW() - INTERVAL '30 days'
        ${city ? 'AND city = $1' : ''}
    `, city ? [city] : []);

    stats.total_contributions = { value: totalDonations, days_tracked: 1 };
    stats.active_members = { value: parseInt(activeMembers.rows[0].count), days_tracked: 1 };
    
    if (stats.money_donations?.value > 0 && stats.active_members?.value > 0) {
      stats.avg_donation_per_user = { 
        value: Math.round(stats.money_donations.value / stats.active_members.value), 
        days_tracked: 1 
      };
    }
  }

  private async clearStatsCaches(statType?: string, city?: string) {
    const patterns = [
      'community_stats_*',
      'community_trends_*',
      'city_stats_*',
      'dashboard_stats',
      'real_time_stats',
      'category_analytics',
      'user_analytics'
    ];

    for (const pattern of patterns) {
      const keys = await this.redisCache.getKeys(pattern);
      for (const key of keys) {
        await this.redisCache.delete(key);
      }
    }
  }
}
