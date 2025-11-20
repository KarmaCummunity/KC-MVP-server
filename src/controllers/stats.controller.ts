// File overview:
// - Purpose: Stats/analytics endpoints for community, trends, city-level, category/user analytics, dashboard, and real-time metrics.
// - Reached from: Routes under '/api/stats'.
// - Provides: Aggregations over `community_stats`, donations/rides/users; caches responses with TTL; cache invalidation helpers.

// TODO: CRITICAL - This file is extremely long (529+ lines). Split into specialized services:
//   - CommunityStatsService for community-wide analytics
//   - TrendsAnalyticsService for trend analysis
//   - UserStatsService for user-specific analytics
//   - DashboardStatsService for dashboard data
//   - StatsCache service for cache management
// TODO: Add comprehensive DTO validation for all query parameters
// TODO: Implement proper pagination for large datasets
// TODO: Add comprehensive error handling and validation
// TODO: Replace hardcoded SQL queries with proper query builder
// TODO: Add comprehensive caching strategies with proper invalidation
// TODO: Implement proper authorization for sensitive stats
// TODO: Add comprehensive logging and monitoring for analytics queries
// TODO: Add comprehensive unit tests for all statistical calculations
// TODO: Implement proper data privacy and anonymization
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
  // שינוי: הוספת תמיכה ב-forceRefresh parameter לטעינה מחדש של נתונים
  // Change: Added support for forceRefresh parameter to reload data
  async getCommunityStats(
    @Query('city') city?: string, 
    @Query('period') period?: string,
    @Query('forceRefresh') forceRefresh?: string
  ) {
    // TODO: Add comprehensive input validation for city and period parameters
    // TODO: Implement proper DTO for query parameters with validation
    // TODO: Add proper cache key generation utility to prevent key collisions
    // TODO: Add comprehensive error handling for cache operations
    const cacheKey = `community_stats_${city || 'global'}_${period || 'current'}`;
    
    // Only use cache if forceRefresh is not true
    // שינוי: תמיכה ב-forceRefresh לדילוג על cache וטעינה מחדש מהמסד נתונים
    // Change: Support for forceRefresh to skip cache and reload from database
    if (forceRefresh !== 'true') {
      const cached = await this.redisCache.get(cacheKey);
      
      if (cached) {
        return { success: true, data: cached };
      }
    } else {
      // Clear cache when force refresh is requested
      // ניקוי cache כאשר מתבקש force refresh
      await this.redisCache.delete(cacheKey);
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
    // שינוי: פורמט תגובה עם מבנה value object לתמיכה במיפוי בצד הלקוח
    // Change: Response format with value object structure for client-side mapping support
    // TODO: Replace 'any' type with proper statistics response interface
    // TODO: Add proper data validation and error handling
    // TODO: Implement proper data transformation utilities
    const stats: any = {};
    rows.forEach(row => {
      stats[row.stat_type] = {
        value: parseInt(row.total_value), // TODO: Add proper number parsing with validation
        days_tracked: parseInt(row.days_tracked) // TODO: Add proper number parsing with validation
      };
    });

    // Add computed stats
    // הוספת סטטיסטיקות מחושבות (unique_donors, total_money_donated, וכו')
    // Adding computed stats (unique_donors, total_money_donated, etc.)
    await this.addComputedStats(stats, city);

    await this.redisCache.set(cacheKey, stats, this.CACHE_TTL);
    return { success: true, data: stats };
  }

  @Get('community/version')
  // Lightweight endpoint to check if stats have changed
  // נקודת קצה קלת משקל לבדיקה אם הסטטיסטיקות השתנו
  async getCommunityStatsVersion(@Query('city') city?: string) {
    const cacheKey = `community_stats_version_${city || 'global'}`;
    
    // Check cache first (1 minute TTL for version check)
    const cached = await this.redisCache.get(cacheKey);
    if (cached) {
      return { success: true, version: cached };
    }

    // Get the latest update timestamp from community_stats
    const query = `
      SELECT MAX(updated_at) as last_update
      FROM community_stats
      ${city ? 'WHERE city = $1' : 'WHERE city IS NULL'}
    `;
    
    const params = city ? [city] : [];
    const { rows } = await this.pool.query(query, params);
    
    // Create version hash from timestamp
    const lastUpdate = rows[0]?.last_update || new Date();
    const version = new Date(lastUpdate).getTime().toString();
    
    // Cache for 1 minute
    await this.redisCache.set(cacheKey, version, 60);
    
    return { success: true, version };
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

  @Post('track-visit')
  async trackSiteVisit() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Track site visit - global stat, no city filter
      await client.query(`
        INSERT INTO community_stats (stat_type, stat_value, city, date_period)
        VALUES ('site_visits', 1, NULL, CURRENT_DATE)
        ON CONFLICT (stat_type, city, date_period) 
        DO UPDATE SET 
          stat_value = community_stats.stat_value + 1,
          updated_at = NOW()
      `);

      // Clear relevant caches
      await this.clearStatsCaches('site_visits', undefined);

      await client.query('COMMIT');
      return { success: true, message: 'Site visit tracked successfully' };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Track site visit error:', error);
      return { success: false, error: 'Failed to track site visit' };
    } finally {
      client.release();
    }
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
    const params = city ? [city] : [];
    const userCityCondition = city ? 'AND city = $1' : '';
    const donationCityCondition = city ? 'AND (d.location->>\'city\' = $1)' : '';
    const rideCityCondition = city ? 'AND (from_location->>\'city\' = $1)' : '';
    const eventCityCondition = city ? 'AND (location->>\'city\' = $1)' : '';

    // Basic counts and metrics
    const queries = await Promise.all([
      // User metrics
      this.pool.query(`
        SELECT 
          COUNT(DISTINCT id) as total_users,
          COUNT(CASE WHEN is_active = true AND last_active >= NOW() - INTERVAL '30 days' THEN 1 END) as active_members,
          COUNT(CASE WHEN last_active >= NOW() - INTERVAL '1 day' THEN 1 END) as daily_active_users,
          COUNT(CASE WHEN last_active >= NOW() - INTERVAL '7 days' THEN 1 END) as weekly_active_users,
          COUNT(CASE WHEN join_date >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as new_users_this_week,
          COUNT(CASE WHEN join_date >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as new_users_this_month,
          COUNT(CASE WHEN 'org_admin' = ANY(roles) THEN 1 END) as total_organizations,
          COUNT(DISTINCT city) as cities_with_users
        FROM user_profiles 
        WHERE 1=1 ${userCityCondition}
          AND email IS NOT NULL
          AND email <> ''
      `, params),

      // Donation metrics
      this.pool.query(`
        SELECT 
          COUNT(*) as total_donations,
          COUNT(CASE WHEN d.created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as donations_this_week,
          COUNT(CASE WHEN d.created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as donations_this_month,
          COUNT(CASE WHEN d.status = 'active' THEN 1 END) as active_donations,
          COUNT(CASE WHEN d.status = 'completed' THEN 1 END) as completed_donations,
          COUNT(CASE WHEN d.type = 'money' THEN 1 END) as money_donations,
          COUNT(CASE WHEN d.type = 'item' AND d.status = 'active' THEN 1 END) as item_donations,
          COUNT(CASE WHEN d.type = 'service' THEN 1 END) as service_donations,
          COUNT(CASE WHEN d.type = 'time' THEN 1 END) as volunteer_hours,
          SUM(CASE WHEN d.type = 'money' THEN d.amount ELSE 0 END) as total_money_donated,
          SUM(CASE WHEN d.type = 'money' AND d.is_recurring = true AND d.status = 'active' THEN d.amount ELSE 0 END) as recurring_donations_amount,
          COUNT(DISTINCT CASE WHEN d.is_recurring = true AND up.is_active = true THEN d.donor_id END) as unique_donors
        FROM donations d
        LEFT JOIN user_profiles up ON up.id = d.donor_id
        WHERE 1=1 ${donationCityCondition}
      `, params),

      // Ride metrics
      this.pool.query(`
        SELECT 
          COUNT(*) as total_rides,
          COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as rides_this_week,
          COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as rides_this_month,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_rides,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_rides,
          SUM(available_seats) as total_seats_offered,
          COUNT(DISTINCT driver_id) as unique_drivers
        FROM rides 
        WHERE 1=1 ${rideCityCondition}
      `, params),

      // Event metrics
      this.pool.query(`
        SELECT 
          COUNT(*) as total_events,
          COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as events_this_week,
          COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as events_this_month,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_events,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_events,
          SUM(current_attendees) as total_event_attendees,
          COUNT(CASE WHEN is_virtual = true THEN 1 END) as virtual_events
        FROM community_events 
        WHERE 1=1 ${eventCityCondition}
      `, params),

      // Activity and engagement metrics
      this.pool.query(`
        SELECT 
          COUNT(*) as total_activities,
          COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '1 day' THEN 1 END) as activities_today,
          COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as activities_this_week,
          COUNT(CASE WHEN activity_type = 'login' THEN 1 END) as total_logins,
          COUNT(CASE WHEN activity_type = 'donation' THEN 1 END) as donation_activities,
          COUNT(CASE WHEN activity_type = 'chat' THEN 1 END) as chat_activities,
          COUNT(DISTINCT user_id) as active_users_tracked
        FROM user_activities 
        WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
      `, []),

      // Chat and social metrics
      this.pool.query(`
        SELECT 
          COUNT(DISTINCT cm.id) as total_messages,
          COUNT(DISTINCT cc.id) as total_conversations,
          COUNT(CASE WHEN cm.created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as messages_this_week,
          COUNT(CASE WHEN cc.type = 'group' THEN 1 END) as group_conversations,
          COUNT(CASE WHEN cc.type = 'direct' THEN 1 END) as direct_conversations
        FROM chat_conversations cc
        LEFT JOIN chat_messages cm ON cc.id = cm.conversation_id
        WHERE cm.is_deleted = false
      `, []),

      // Site visits - total from community_stats
      this.pool.query(`
        SELECT 
          COALESCE(SUM(stat_value), 0) as site_visits
        FROM community_stats 
        WHERE stat_type = 'site_visits'
      `, [])
    ]);

    const [userMetrics, donationMetrics, rideMetrics, eventMetrics, activityMetrics, chatMetrics, siteVisitsMetrics] = queries;

    // Map all computed stats
    const computed = {
      // User stats
      total_users: { value: parseInt(userMetrics.rows[0].total_users || '0'), days_tracked: 1 },
      active_members: { value: parseInt(userMetrics.rows[0].active_members || '0'), days_tracked: 1 },
      daily_active_users: { value: parseInt(userMetrics.rows[0].daily_active_users || '0'), days_tracked: 1 },
      weekly_active_users: { value: parseInt(userMetrics.rows[0].weekly_active_users || '0'), days_tracked: 1 },
      new_users_this_week: { value: parseInt(userMetrics.rows[0].new_users_this_week || '0'), days_tracked: 1 },
      new_users_this_month: { value: parseInt(userMetrics.rows[0].new_users_this_month || '0'), days_tracked: 1 },
      total_organizations: { value: parseInt(userMetrics.rows[0].total_organizations || '0'), days_tracked: 1 },
      cities_with_users: { value: parseInt(userMetrics.rows[0].cities_with_users || '0'), days_tracked: 1 },

      // Donation stats
      total_donations: { value: parseInt(donationMetrics.rows[0].total_donations || '0'), days_tracked: 1 },
      donations_this_week: { value: parseInt(donationMetrics.rows[0].donations_this_week || '0'), days_tracked: 1 },
      donations_this_month: { value: parseInt(donationMetrics.rows[0].donations_this_month || '0'), days_tracked: 1 },
      active_donations: { value: parseInt(donationMetrics.rows[0].active_donations || '0'), days_tracked: 1 },
      completed_donations: { value: parseInt(donationMetrics.rows[0].completed_donations || '0'), days_tracked: 1 },
      money_donations: { value: parseInt(donationMetrics.rows[0].money_donations || '0'), days_tracked: 1 },
      item_donations: { value: parseInt(donationMetrics.rows[0].item_donations || '0'), days_tracked: 1 },
      service_donations: { value: parseInt(donationMetrics.rows[0].service_donations || '0'), days_tracked: 1 },
      volunteer_hours: { value: parseInt(donationMetrics.rows[0].volunteer_hours || '0'), days_tracked: 1 },
      total_money_donated: { value: parseFloat(donationMetrics.rows[0].total_money_donated || '0'), days_tracked: 1 },
      recurring_donations_amount: { value: parseFloat(donationMetrics.rows[0].recurring_donations_amount || '0'), days_tracked: 1 },
      unique_donors: { value: parseInt(donationMetrics.rows[0].unique_donors || '0'), days_tracked: 1 },

      // Ride stats
      total_rides: { value: parseInt(rideMetrics.rows[0].total_rides || '0'), days_tracked: 1 },
      rides_this_week: { value: parseInt(rideMetrics.rows[0].rides_this_week || '0'), days_tracked: 1 },
      rides_this_month: { value: parseInt(rideMetrics.rows[0].rides_this_month || '0'), days_tracked: 1 },
      active_rides: { value: parseInt(rideMetrics.rows[0].active_rides || '0'), days_tracked: 1 },
      completed_rides: { value: parseInt(rideMetrics.rows[0].completed_rides || '0'), days_tracked: 1 },
      total_seats_offered: { value: parseInt(rideMetrics.rows[0].total_seats_offered || '0'), days_tracked: 1 },
      unique_drivers: { value: parseInt(rideMetrics.rows[0].unique_drivers || '0'), days_tracked: 1 },

      // Event stats
      total_events: { value: parseInt(eventMetrics.rows[0].total_events || '0'), days_tracked: 1 },
      events_this_week: { value: parseInt(eventMetrics.rows[0].events_this_week || '0'), days_tracked: 1 },
      events_this_month: { value: parseInt(eventMetrics.rows[0].events_this_month || '0'), days_tracked: 1 },
      active_events: { value: parseInt(eventMetrics.rows[0].active_events || '0'), days_tracked: 1 },
      completed_events: { value: parseInt(eventMetrics.rows[0].completed_events || '0'), days_tracked: 1 },
      total_event_attendees: { value: parseInt(eventMetrics.rows[0].total_event_attendees || '0'), days_tracked: 1 },
      virtual_events: { value: parseInt(eventMetrics.rows[0].virtual_events || '0'), days_tracked: 1 },

      // Activity stats
      total_activities: { value: parseInt(activityMetrics.rows[0].total_activities || '0'), days_tracked: 1 },
      activities_today: { value: parseInt(activityMetrics.rows[0].activities_today || '0'), days_tracked: 1 },
      activities_this_week: { value: parseInt(activityMetrics.rows[0].activities_this_week || '0'), days_tracked: 1 },
      total_logins: { value: parseInt(activityMetrics.rows[0].total_logins || '0'), days_tracked: 1 },
      donation_activities: { value: parseInt(activityMetrics.rows[0].donation_activities || '0'), days_tracked: 1 },
      chat_activities: { value: parseInt(activityMetrics.rows[0].chat_activities || '0'), days_tracked: 1 },
      active_users_tracked: { value: parseInt(activityMetrics.rows[0].active_users_tracked || '0'), days_tracked: 1 },

      // Chat stats
      total_messages: { value: parseInt(chatMetrics.rows[0].total_messages || '0'), days_tracked: 1 },
      total_conversations: { value: parseInt(chatMetrics.rows[0].total_conversations || '0'), days_tracked: 1 },
      messages_this_week: { value: parseInt(chatMetrics.rows[0].messages_this_week || '0'), days_tracked: 1 },
      group_conversations: { value: parseInt(chatMetrics.rows[0].group_conversations || '0'), days_tracked: 1 },
      direct_conversations: { value: parseInt(chatMetrics.rows[0].direct_conversations || '0'), days_tracked: 1 },

      // Site visits
      site_visits: { value: parseInt(siteVisitsMetrics.rows[0].site_visits || '0'), days_tracked: 1 },

    };

    // Add computed stats to the main stats object
    Object.assign(stats, computed);

    // Add derived metrics after base stats are set
    stats.avg_donation_amount = { 
      value: stats.money_donations?.value > 0 ? Math.round(stats.total_money_donated.value / stats.money_donations.value) : 0, 
      days_tracked: 1 
    };
    stats.avg_seats_per_ride = { 
      value: stats.total_rides?.value > 0 ? Math.round(stats.total_seats_offered.value / stats.total_rides.value) : 0, 
      days_tracked: 1 
    };
    stats.user_engagement_rate = { 
      value: stats.total_users?.value > 0 ? Math.round((stats.weekly_active_users.value / stats.total_users.value) * 100) : 0, 
      days_tracked: 1 
    };

    // Legacy compatibility
    if (!stats.total_contributions) {
      stats.total_contributions = { 
        value: (stats.money_donations?.value || 0) + (stats.volunteer_hours?.value || 0) + (stats.total_rides?.value || 0), 
        days_tracked: 1 
      };
    }
  }

  @Post('community/reset')
  async resetCommunityStats() {
    try {
      // Delete all community_stats records
      await this.pool.query(`DELETE FROM community_stats`);
      
      // Clear all stats-related caches
      await this.clearStatsCaches();
      
      return { success: true, message: 'Community statistics reset successfully' };
    } catch (error) {
      console.error('Reset community stats error:', error);
      return { success: false, error: 'Failed to reset community statistics' };
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
