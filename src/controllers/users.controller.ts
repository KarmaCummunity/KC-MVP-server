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
import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { RedisCacheService } from '../redis/redis-cache.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtService } from '../auth/jwt.service';
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
    private readonly jwtService: JwtService,
  ) { }

  /**
   * Ensure salary and seniority_start_date columns exist in user_profiles table
   * Creates them if missing (idempotent)
   */
  private async ensureSalarySeniorityColumns(): Promise<void> {
    try {
      const client = await this.pool.connect();
      try {
        // Check if columns exist
        const checkResult = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'user_profiles' 
          AND column_name IN ('salary', 'seniority_start_date')
        `);

        const existingColumns = checkResult.rows.map(r => r.column_name);

        if (!existingColumns.includes('salary')) {
          console.log('📋 Adding salary column to user_profiles...');
          await client.query(`
            ALTER TABLE user_profiles 
            ADD COLUMN salary DECIMAL(10,2) DEFAULT 0
          `);
          console.log('✅ Added salary column');
        }

        if (!existingColumns.includes('seniority_start_date')) {
          console.log('📋 Adding seniority_start_date column to user_profiles...');
          await client.query(`
            ALTER TABLE user_profiles 
            ADD COLUMN seniority_start_date DATE DEFAULT CURRENT_DATE
          `);
          console.log('✅ Added seniority_start_date column');
        }
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Error ensuring salary/seniority columns:', error);
      // Don't throw - allow fallback query to work
    }
  }

  /**
   * Search users for autocomplete (lightweight)
   * GET /api/users/search?q=...
   */
  @Get('search')
  async searchUsers(@Query('q') query: string) {
    if (!query || query.length < 2) {
      return { success: true, data: [] };
    }

    try {
      const { rows } = await this.pool.query(`
        SELECT id, name, email, avatar_url, roles
        FROM user_profiles
        WHERE (name ILIKE $1 OR email ILIKE $1)
        AND is_active = true
        LIMIT 20
      `, [`%${query}%`]);

      return { success: true, data: rows };
    } catch (error) {
      console.error('Search users error:', error);
      return { success: false, error: 'Failed to search users' };
    }
  }

  /**
   * Set parent manager for a user
   * POST /api/users/:id/set-manager
   * Body: { managerId: string | null, requestingUserId?: string }
   */
  @Post(':id/set-manager')
  @UseGuards(JwtAuthGuard)
  async setManager(@Param('id') id: string, @Body() body: { managerId: string | null | undefined, requestingUserId?: string }) {
    try {
      const { managerId, requestingUserId } = body;

      console.log(`[setManager] Setting manager for user ${id}: managerId=${managerId} (type: ${typeof managerId}), requestingUserId=${requestingUserId}`);
      console.log(`[setManager] Full body:`, JSON.stringify(body));

      // Permission check: only admin or super admin can change manager assignments
      if (requestingUserId) {
        const { rows: reqUser } = await this.pool.query(
          `SELECT id, email, roles FROM user_profiles WHERE id = $1`,
          [requestingUserId]
        );

        if (reqUser.length > 0) {
          const isSuperAdmin = ['navesarussi@gmail.com', 'karmacommunity2.0@gmail.com'].includes(reqUser[0].email);
          const isAdmin = (reqUser[0].roles || []).includes('admin') ||
            (reqUser[0].roles || []).includes('super_admin') ||
            isSuperAdmin;

          if (!isAdmin) {
            console.log(`[setManager] Permission denied for user ${requestingUserId}`);
            return { success: false, error: 'אין לך הרשאה לבצע פעולה זו - נדרשות הרשאות מנהל' };
          }
        }
      }

      // If managerId is null or undefined, we're removing the manager assignment
      if (managerId === null || managerId === undefined || managerId === 'null' || managerId === '') {
        // Check current state
        const { rows: currentUser } = await this.pool.query(
          'SELECT parent_manager_id FROM user_profiles WHERE id = $1',
          [id]
        );

        if (currentUser.length === 0) {
          console.log(`[setManager] User not found: ${id}`);
          return { success: false, error: 'User not found' };
        }

        // Logic: When removing a manager, also remove the 'admin' role.
        // Users without a manager should not be admins (unless they are super_admin).
        const currentManagerId = currentUser[0].parent_manager_id;
        console.log(`[setManager] Removing manager assignment for user ${id}, current manager: ${currentManagerId}`);

        // Update to remove manager AND remove 'admin' role
        // We use array_remove to remove 'admin' from the roles array
        // NOTE: This will not remove 'super_admin' if present
        await this.pool.query(`
          UPDATE user_profiles 
          SET 
            parent_manager_id = NULL, 
            updated_at = NOW(),
            roles = array_remove(roles, 'admin')
          WHERE id = $1
        `, [id]);

        // Invalidate caches to ensure fresh data
        await this.redisCache.delete(`user_profile_${id}`);
        await this.redisCache.invalidatePattern('users_list*');
        console.log(`[setManager] Invalidated cache for user ${id} and all user lists`);

        console.log(`✅ Manager removed: ${id} no longer reports to anyone`);
        return { success: true, message: 'שיוך מנהל הוסר בהצלחה' };
      }

      // Prevent validation loop (user cannot be their own manager)
      if (managerId === id) {
        return { success: false, error: 'User cannot be their own manager' };
      }

      // Check if manager exists
      const checkManager = await this.pool.query('SELECT id FROM user_profiles WHERE id = $1', [managerId]);
      if (checkManager.rows.length === 0) {
        return { success: false, error: 'Manager not found' };
      }

      // Full cycle detection using recursive CTE
      // Check if 'id' (subordinate) appears anywhere in managerId's hierarchy chain
      const { rows: cycleCheck } = await this.pool.query(`
        WITH RECURSIVE manager_chain AS (
          -- Base case: start from the proposed manager
          SELECT id, parent_manager_id, 1 as depth
          FROM user_profiles
          WHERE id = $1
          
          UNION ALL
          
          -- Recursive: go up the chain
          SELECT u.id, u.parent_manager_id, mc.depth + 1
          FROM user_profiles u
          INNER JOIN manager_chain mc ON u.id = mc.parent_manager_id
          WHERE mc.depth < 100
        )
        SELECT 1 FROM manager_chain WHERE id = $2 LIMIT 1
      `, [managerId, id]);

      if (cycleCheck.length > 0) {
        return { success: false, error: 'Cannot create hierarchy cycle - this would create a circular management chain' };
      }

      // Check reverse direction - if manager is subordinate of user
      const { rows: reverseCheck } = await this.pool.query(`
        WITH RECURSIVE subordinate_tree AS (
          -- Base case: direct subordinates of user
          SELECT id, parent_manager_id, 1 as depth
          FROM user_profiles
          WHERE parent_manager_id = $2
          
          UNION ALL
          
          -- Recursive: subordinates of subordinates
          SELECT u.id, u.parent_manager_id, st.depth + 1
          FROM user_profiles u
          INNER JOIN subordinate_tree st ON u.parent_manager_id = st.id
          WHERE st.depth < 100
        )
        SELECT 1 FROM subordinate_tree WHERE id = $1 LIMIT 1
      `, [managerId, id]);

      if (reverseCheck.length > 0) {
        return { success: false, error: 'Cannot assign - the proposed manager is currently your subordinate' };
      }

      console.log(`[setManager] 📝 Before UPDATE: user=${id}, new parent_manager_id=${managerId}`);

      // Logic: Start of "Manager Assignment".
      // When a user is assigned a manager, they automatically become an 'admin'.
      // This allows them to effectively manage employees under them (if they are assigned any).
      // Update to set manager AND ensure 'admin' role
      await this.pool.query(`
        UPDATE user_profiles 
        SET 
          parent_manager_id = $1, 
          updated_at = NOW(),
          roles = CASE 
            WHEN NOT (roles::text[] @> ARRAY['admin']) THEN array_append(roles, 'admin')
            ELSE roles
          END
        WHERE id = $2
      `, [managerId, id]);

      // Invalidate caches to ensure fresh data
      await this.redisCache.delete(`user_profile_${id}`);
      await this.redisCache.delete(`user_profile_${managerId}`);
      await this.redisCache.invalidatePattern('users_list*');
      console.log(`[setManager] ♻️ Invalidated cache for users ${id} and ${managerId} and all user lists`);

      console.log(`✅ Manager set: ${id} now reports to ${managerId}`);
      console.log(`[setManager] 📊 Updated: parent_manager_id=${managerId}`);

      return { success: true, message: 'Manager updated successfully' };
    } catch (error) {
      console.error('Set manager error:', error);
      return { success: false, error: 'Failed to set manager' };
    }
  }

  /**
   * Manage hierarchy: Add or Remove subordinate
   * POST /api/users/:id/hierarchy/manage
   * Body: { action: 'add' | 'remove', managerId: string }
   */
  @Post(':id/hierarchy/manage')
  @UseGuards(JwtAuthGuard)
  async manageHierarchy(@Param('id') subordinateId: string, @Body() body: { action: 'add' | 'remove', managerId: string }) {
    const client = await this.pool.connect();
    try {
      const { action, managerId } = body;
      await client.query('BEGIN');

      if (action === 'add') {
        // Full cycle detection using recursive CTE
        // Check if subordinateId appears anywhere in managerId's hierarchy chain (upwards)
        // This prevents: A → B → C → A cycles at any depth
        const { rows: cycleCheck } = await client.query(`
          WITH RECURSIVE manager_chain AS (
            -- Base case: start from the proposed manager
            SELECT id, parent_manager_id, 1 as depth
            FROM user_profiles
            WHERE id = $1
            
            UNION ALL
            
            -- Recursive: go up the chain
            SELECT u.id, u.parent_manager_id, mc.depth + 1
            FROM user_profiles u
            INNER JOIN manager_chain mc ON u.id = mc.parent_manager_id
            WHERE mc.depth < 100  -- Prevent infinite loops in case of existing cycles
          )
          SELECT 1 FROM manager_chain WHERE id = $2 LIMIT 1
        `, [managerId, subordinateId]);

        if (cycleCheck.length > 0) {
          await client.query('ROLLBACK');
          return { success: false, error: 'Cannot create hierarchy cycle - this would create a circular management chain' };
        }

        // Also check if subordinate would become manager of someone in their own chain
        const { rows: reverseCheck } = await client.query(`
          WITH RECURSIVE subordinate_chain AS (
            -- Base case: start from the subordinate
            SELECT id, parent_manager_id, 1 as depth
            FROM user_profiles
            WHERE id = $2
            
            UNION ALL
            
            -- Recursive: go up the chain
            SELECT u.id, u.parent_manager_id, sc.depth + 1
            FROM user_profiles u
            INNER JOIN subordinate_chain sc ON u.id = sc.parent_manager_id
            WHERE sc.depth < 100
          )
          SELECT 1 FROM subordinate_chain WHERE id = $1 LIMIT 1
        `, [managerId, subordinateId]);

        if (reverseCheck.length > 0) {
          await client.query('ROLLBACK');
          return { success: false, error: 'Cannot assign - this user is already in your management chain' };
        }

        await client.query(`
          UPDATE user_profiles 
          SET parent_manager_id = $1, updated_at = NOW()
          WHERE id = $2
        `, [managerId, subordinateId]);

        await client.query('COMMIT');
        console.log(`✅ Hierarchy updated: ${subordinateId} now reports to ${managerId}`);
        return { success: true, message: 'Subordinate added successfully' };

      } else if (action === 'remove') {
        // Validate that they are currently managed by this manager
        const { rows: currentCheck } = await client.query('SELECT parent_manager_id, name, email FROM user_profiles WHERE id = $1', [subordinateId]);
        if (currentCheck[0]?.parent_manager_id !== managerId) {
          await client.query('ROLLBACK');
          return { success: false, error: 'User is not your subordinate' };
        }

        const subordinateName = currentCheck[0]?.name || currentCheck[0]?.email || 'Unknown';

        // 1. Get tasks that will be transferred (for notification and logging)
        const { rows: tasksToTransfer } = await client.query(`
          SELECT id, title, status, priority
          FROM tasks
          WHERE $1::UUID = ANY(assignees::UUID[]) 
          AND status NOT IN ('done', 'archived')
        `, [subordinateId]);

        const transferCount = tasksToTransfer.length;
        console.log(`📋 Found ${transferCount} active tasks to transfer from ${subordinateId} to ${managerId}`);

        // 2. Remove manager link
        await client.query(`
          UPDATE user_profiles 
          SET parent_manager_id = NULL, updated_at = NOW()
          WHERE id = $1
        `, [subordinateId]);

        // 3. Transfer active tasks (assignees) from subordinate to manager
        if (transferCount > 0) {
          await client.query(`
            UPDATE tasks
            SET assignees = array_replace(assignees::UUID[], $1::UUID, $2::UUID)::UUID[],
                updated_at = NOW()
            WHERE $1::UUID = ANY(assignees::UUID[]) 
            AND status NOT IN ('done', 'archived')
          `, [subordinateId, managerId]);

          console.log(`✅ Transferred ${transferCount} tasks from ${subordinateName} to manager ${managerId}`);

          // Log the transfer details
          console.log('📝 Transferred tasks:', tasksToTransfer.map(t => `${t.id.substring(0, 8)}: ${t.title} (${t.priority})`).join(', '));
        }

        await client.query('COMMIT');

        // 4. Create notification for manager about transferred tasks (non-blocking)
        if (transferCount > 0) {
          try {
            // Insert notification directly to the database
            await this.pool.query(`
              INSERT INTO notifications (user_id, item_id, data, created_at)
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT (user_id, item_id) DO NOTHING
            `, [
              managerId,
              require('crypto').randomUUID(),
              JSON.stringify({
                title: 'משימות הועברו אליך',
                body: `${transferCount} משימות הועברו אליך מ${subordinateName} שהוסר מהניהול שלך`,
                type: 'system',
                timestamp: new Date().toISOString(),
                read: false,
                data: {
                  transferredTaskIds: tasksToTransfer.map(t => t.id),
                  fromUser: subordinateId,
                  fromUserName: subordinateName,
                  count: transferCount
                }
              })
            ]);
            console.log(`🔔 Notification sent to manager ${managerId} about ${transferCount} transferred tasks`);
          } catch (notifError) {
            console.warn('Failed to create transfer notification (non-fatal):', notifError);
          }
        }

        return {
          success: true,
          message: `Subordinate removed and ${transferCount} tasks transferred`,
          data: { transferredTasks: transferCount }
        };
      }

      await client.query('ROLLBACK');
      return { success: false, error: 'Invalid action' };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Manage hierarchy error:', error);
      return { success: false, error: 'Failed to manage hierarchy' };
    } finally {
      client.release();
    }
  }

  /**
   * Promote a user to admin role with hierarchy validation
   * POST /api/users/:id/promote-admin
   * Body: { requestingAdminId: string }
   * 
   * Rules:
   * 1. The requesting admin must be an admin
   * 2. The target user must NOT already be an admin under someone else
   * 3. The target user must NOT be a manager above the requesting admin
   * 4. The target user will be set as subordinate of the requesting admin
   */
  @Post(':id/promote-admin')
  @UseGuards(JwtAuthGuard)
  async promoteToAdmin(@Param('id') targetUserId: string, @Body() body: { requestingAdminId: string }) {
    const client = await this.pool.connect();
    try {
      const { requestingAdminId } = body;

      console.log(`[promoteToAdmin] 📝 Request: targetUserId=${targetUserId}, requestingAdminId=${requestingAdminId}`);

      if (!requestingAdminId) {
        return { success: false, error: 'requestingAdminId is required' };
      }

      await client.query('BEGIN');

      // 1. Verify requesting user exists and is an admin
      const { rows: requestingUser } = await client.query(
        `SELECT id, email, roles FROM user_profiles WHERE id = $1`,
        [requestingAdminId]
      );

      console.log(`[promoteToAdmin] 🔍 Requesting user lookup:`, {
        requestingAdminId,
        found: requestingUser.length > 0,
        user: requestingUser[0] || null
      });

      if (requestingUser.length === 0) {
        await client.query('ROLLBACK');
        console.log(`[promoteToAdmin] ❌ Requesting user not found: ${requestingAdminId}`);
        return { success: false, error: 'Requesting user not found' };
      }

      const isSuperAdmin = ['navesarussi@gmail.com', 'karmacommunity2.0@gmail.com'].includes(requestingUser[0].email);
      const isAdmin = (requestingUser[0].roles || []).includes('admin') ||
        (requestingUser[0].roles || []).includes('super_admin') ||
        isSuperAdmin;

      console.log(`[promoteToAdmin] 🔐 Authorization check:`, {
        email: requestingUser[0].email,
        roles: requestingUser[0].roles,
        isSuperAdmin,
        isAdmin
      });

      if (!isAdmin) {
        await client.query('ROLLBACK');
        console.log(`[promoteToAdmin] ❌ Authorization denied - not an admin`);
        return { success: false, error: 'אין לך הרשאה לבצע פעולה זו - נדרשות הרשאות מנהל' };
      }

      // 2. Get target user info
      const { rows: targetUser } = await client.query(
        `SELECT id, name, email, roles, parent_manager_id FROM user_profiles WHERE id = $1`,
        [targetUserId]
      );

      if (targetUser.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'User not found' };
      }

      const targetIsSuperAdmin = ['navesarussi@gmail.com', 'karmacommunity2.0@gmail.com'].includes(targetUser[0].email);
      if (targetIsSuperAdmin) {
        await client.query('ROLLBACK');
        return { success: false, error: 'לא ניתן לשנות הרשאות למנהל הראשי' };
      }

      const targetIsAlreadyAdmin = (targetUser[0].roles || []).includes('admin') ||
        (targetUser[0].roles || []).includes('super_admin');

      // 3. Check if target is already an admin under someone else
      if (targetIsAlreadyAdmin && targetUser[0].parent_manager_id) {
        if (targetUser[0].parent_manager_id !== requestingAdminId) {
          await client.query('ROLLBACK');
          return { success: false, error: 'משתמש זה כבר מנהל תחת מישהו אחר - לא ניתן להעביר' };
        }
        // Already an admin under requesting admin - nothing to do
        await client.query('ROLLBACK');
        return { success: true, message: 'משתמש זה כבר מנהל תחתיך' };
      }

      // 4. Check if target is in the management chain above the requesting admin
      // (Cannot promote your own manager or their managers)
      if (!isSuperAdmin) {
        const { rows: chainCheck } = await client.query(`
          WITH RECURSIVE manager_chain AS (
            SELECT id, parent_manager_id, 1 as depth
            FROM user_profiles
            WHERE id = $1
            
            UNION ALL
            
            SELECT u.id, u.parent_manager_id, mc.depth + 1
            FROM user_profiles u
            INNER JOIN manager_chain mc ON u.id = mc.parent_manager_id
            WHERE mc.depth < 100
          )
          SELECT 1 FROM manager_chain WHERE id = $2 LIMIT 1
        `, [requestingAdminId, targetUserId]);

        if (chainCheck.length > 0) {
          await client.query('ROLLBACK');
          return { success: false, error: 'לא ניתן להפוך את המנהל שלך או מנהלים מעליו למנהל תחתיך' };
        }
      }

      // 5. All checks passed - promote the user
      // Add 'admin' role and set parent_manager_id
      const currentRoles = Array.isArray(targetUser[0].roles) ? targetUser[0].roles : [];
      // Ensure unique roles and add admin
      const uniqueRoles = new Set(currentRoles);
      uniqueRoles.add('admin');
      const newRoles = Array.from(uniqueRoles);

      await client.query(`
        UPDATE user_profiles 
        SET roles = $1::text[], parent_manager_id = $2, updated_at = NOW()
        WHERE id = $3
      `, [newRoles, requestingAdminId, targetUserId]);

      await client.query('COMMIT');

      // Invalidate caches to ensure fresh data on next request
      await this.redisCache.delete(`user_profile_${targetUserId}`);
      await this.redisCache.delete(`user_profile_${requestingAdminId}`);
      await this.redisCache.invalidatePattern('users_list*');
      console.log(`[promoteToAdmin] ♻️ Invalidated cache for users ${targetUserId} and ${requestingAdminId}`);

      console.log(`✅ User ${targetUserId} promoted to admin under ${requestingAdminId}`);
      console.log(`[promoteToAdmin] 📊 Updated: roles=${JSON.stringify(newRoles)}, parent_manager_id=${requestingAdminId}`);

      return {
        success: true,
        message: `${targetUser[0].name || targetUser[0].email} הפך למנהל תחתיך`
      };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Promote to admin error:', error);
      return { success: false, error: 'Failed to promote user to admin' };
    } finally {
      client.release();
    }
  }

  /**
   * Demote an admin to regular user (remove admin role)
   * POST /api/users/:id/demote-admin
   * Body: { requestingAdminId: string }
   * 
   * Rules:
   * 1. The requesting admin must be an admin
   * 2. Can only demote admins that are YOUR subordinates
   * 3. Super admin can demote anyone except themselves
   */
  @Post(':id/demote-admin')
  @UseGuards(JwtAuthGuard)
  async demoteAdmin(@Param('id') targetUserId: string, @Body() body: { requestingAdminId: string }) {
    const client = await this.pool.connect();
    try {
      const { requestingAdminId } = body;

      console.log(`[demoteAdmin] 📝 Request: targetUserId=${targetUserId}, requestingAdminId=${requestingAdminId}`);

      if (!requestingAdminId) {
        return { success: false, error: 'requestingAdminId is required' };
      }

      await client.query('BEGIN');

      // 1. Verify requesting user exists and is an admin
      const { rows: requestingUser } = await client.query(
        `SELECT id, email, roles FROM user_profiles WHERE id = $1`,
        [requestingAdminId]
      );

      console.log(`[demoteAdmin] 🔍 Requesting user lookup:`, {
        requestingAdminId,
        found: requestingUser.length > 0,
        user: requestingUser[0] || null
      });

      if (requestingUser.length === 0) {
        await client.query('ROLLBACK');
        console.log(`[demoteAdmin] ❌ Requesting user not found: ${requestingAdminId}`);
        return { success: false, error: 'Requesting user not found' };
      }

      const isSuperAdmin = ['navesarussi@gmail.com', 'karmacommunity2.0@gmail.com'].includes(requestingUser[0].email);
      const isAdmin = (requestingUser[0].roles || []).includes('admin') ||
        (requestingUser[0].roles || []).includes('super_admin') ||
        isSuperAdmin;

      console.log(`[demoteAdmin] 🔐 Authorization check:`, {
        email: requestingUser[0].email,
        roles: requestingUser[0].roles,
        isSuperAdmin,
        isAdmin
      });

      if (!isAdmin) {
        await client.query('ROLLBACK');
        console.log(`[demoteAdmin] ❌ Authorization denied - not an admin`);
        return { success: false, error: 'אין לך הרשאה לבצע פעולה זו - נדרשות הרשאות מנהל' };
      }

      // 2. Get target user info
      const { rows: targetUser } = await client.query(
        `SELECT id, name, email, roles, parent_manager_id FROM user_profiles WHERE id = $1`,
        [targetUserId]
      );

      if (targetUser.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'User not found' };
      }

      const targetIsSuperAdmin = ['navesarussi@gmail.com', 'karmacommunity2.0@gmail.com'].includes(targetUser[0].email);
      if (targetIsSuperAdmin) {
        await client.query('ROLLBACK');
        return { success: false, error: 'לא ניתן לשנות הרשאות למנהל הראשי' };
      }

      // 3. Check authorization - can only demote your own subordinates
      if (!isSuperAdmin) {
        // Check if target is a direct subordinate OR in the subordinate tree
        const { rows: subordinateCheck } = await client.query(`
          WITH RECURSIVE subordinates AS (
            SELECT id, 1 as depth FROM user_profiles WHERE parent_manager_id = $1
            UNION ALL
            SELECT u.id, s.depth + 1
            FROM user_profiles u
            INNER JOIN subordinates s ON u.parent_manager_id = s.id
            WHERE s.depth < 100
          )
          SELECT 1 FROM subordinates WHERE id = $2 LIMIT 1
        `, [requestingAdminId, targetUserId]);

        if (subordinateCheck.length === 0) {
          await client.query('ROLLBACK');
          return { success: false, error: 'ניתן להסיר הרשאות מנהל רק ממנהלים שתחתיך' };
        }
      }

      // 4. Remove admin role
      const currentRoles = Array.isArray(targetUser[0].roles) ? targetUser[0].roles : [];
      // Remove admin and super_admin roles
      const newRoles = currentRoles.filter((r: string) => r !== 'admin' && r !== 'super_admin');

      console.log(`[demoteAdmin] 📝 Before UPDATE: target=${targetUserId}, currentRoles=${JSON.stringify(currentRoles)}, newRoles=${JSON.stringify(newRoles)}`);

      // Also clear parent_manager_id since they're no longer an admin
      await client.query(`
        UPDATE user_profiles 
        SET roles = $1::text[], parent_manager_id = NULL, updated_at = NOW()
        WHERE id = $2
      `, [newRoles, targetUserId]);

      await client.query('COMMIT');

      // Invalidate caches to ensure fresh data on next request
      await this.redisCache.delete(`user_profile_${targetUserId}`);
      await this.redisCache.delete(`user_profile_${requestingAdminId}`);
      await this.redisCache.invalidatePattern('users_list*');
      console.log(`[demoteAdmin] ♻️ Invalidated cache for users ${targetUserId} and ${requestingAdminId}`);

      console.log(`✅ User ${targetUserId} demoted from admin by ${requestingAdminId}`);
      console.log(`[demoteAdmin] 📊 Updated: roles=${JSON.stringify(newRoles)}, parent_manager_id=NULL`);

      return {
        success: true,
        message: `הרשאות מנהל הוסרו מ-${targetUser[0].name || targetUser[0].email}`
      };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Demote admin error:', error);
      return { success: false, error: 'Failed to demote admin' };
    } finally {
      client.release();
    }
  }

  /**
   * Get users eligible for admin promotion by a specific admin
   * GET /api/users/eligible-for-promotion/:adminId
   * Returns users that can be promoted by this admin
   */
  @Get('eligible-for-promotion/:adminId')
  async getEligibleForPromotion(@Param('adminId') adminId: string) {
    try {
      // Get admin info
      const { rows: adminRows } = await this.pool.query(
        `SELECT id, email, roles FROM user_profiles WHERE id = $1`,
        [adminId]
      );

      if (adminRows.length === 0) {
        return { success: false, error: 'Admin not found' };
      }

      const isSuperAdmin = ['navesarussi@gmail.com', 'karmacommunity2.0@gmail.com'].includes(adminRows[0].email);

      // Get all users who are NOT:
      // 1. The requesting admin themselves
      // 2. Already admins under someone else (unless super admin)
      // 3. In the management chain above the requesting admin
      // 4. Super admin

      let query: string;
      let params: any[];

      if (isSuperAdmin) {
        // Super admin can promote anyone who isn't already an admin OR is an orphan admin
        query = `
          SELECT id, name, email, avatar_url, roles, parent_manager_id
          FROM user_profiles
          WHERE id != $1
          AND email NOT IN ('navesarussi@gmail.com', 'karmacommunity2.0@gmail.com')
          AND (
            -- Not an admin yet
            NOT ('admin' = ANY(roles) OR 'super_admin' = ANY(roles))
            -- OR is an admin without a parent (orphan admin - can be reassigned)
            OR (('admin' = ANY(roles) OR 'super_admin' = ANY(roles)) AND parent_manager_id IS NULL)
          )
          ORDER BY name
        `;
        params = [adminId];
      } else {
        // Regular admins can only promote users who:
        // - Are not admins yet
        // - Are not in their management chain above them
        query = `
          WITH RECURSIVE manager_chain AS (
            -- Get all managers above requesting admin
            SELECT id, parent_manager_id, 1 as depth
            FROM user_profiles
            WHERE id = $1
            
            UNION ALL
            
            SELECT u.id, u.parent_manager_id, mc.depth + 1
            FROM user_profiles u
            INNER JOIN manager_chain mc ON u.id = mc.parent_manager_id
            WHERE mc.depth < 100
          )
          SELECT u.id, u.name, u.email, u.avatar_url, u.roles, u.parent_manager_id
          FROM user_profiles u
          WHERE u.id != $1
          AND u.email NOT IN ('navesarussi@gmail.com', 'karmacommunity2.0@gmail.com')
          -- Not already an admin under someone else
          AND NOT (
            ('admin' = ANY(u.roles) OR 'super_admin' = ANY(u.roles))
            AND u.parent_manager_id IS NOT NULL
            AND u.parent_manager_id != $1
          )
          -- Not in management chain above
          AND u.id NOT IN (SELECT id FROM manager_chain)
          ORDER BY u.name
        `;
        params = [adminId];
      }

      const { rows } = await this.pool.query(query, params);

      return { success: true, data: rows };

    } catch (error) {
      console.error('Get eligible for promotion error:', error);
      return { success: false, error: 'Failed to get eligible users' };
    }
  }

  /**
   * Get full admin hierarchy tree starting from super admin
   * GET /api/users/hierarchy/tree
   * Returns a nested tree structure of all managers
   * NOTE: This route MUST be defined BEFORE :id/hierarchy to avoid route conflict
   */
  @Get('hierarchy/tree')
  async getFullHierarchyTree() {
    try {
      // Ensure columns exist before querying
      await this.ensureSalarySeniorityColumns();

      // First, get the super admin (root of the tree)
      const { rows: superAdminRows } = await this.pool.query(`
        SELECT id, name, email, avatar_url, roles
        FROM user_profiles
        WHERE email = 'navesarussi@gmail.com'
        LIMIT 1
      `);

      if (superAdminRows.length === 0) {
        return { success: false, error: 'Super admin not found' };
      }

      const superAdmin = superAdminRows[0];

      // Try query with salary/seniority fields, fallback if columns don't exist
      let allUsers: any[];
      try {
        const result = await this.pool.query(`
          WITH RECURSIVE hierarchy AS (
            -- Base case: super admin (root)
            SELECT 
              id, name, email, avatar_url, parent_manager_id, roles, salary, seniority_start_date,
              0 as level,
              ARRAY[id] as path
            FROM user_profiles
            WHERE email = 'navesarussi@gmail.com'
            
            UNION ALL
            
            -- Recursive: all subordinates
            SELECT 
              u.id, u.name, u.email, u.avatar_url, u.parent_manager_id, u.roles, u.salary, u.seniority_start_date,
              h.level + 1,
              h.path || u.id
            FROM user_profiles u
            INNER JOIN hierarchy h ON u.parent_manager_id = h.id
            WHERE h.level < 10  -- Max depth to prevent infinite loops
          )
          SELECT 
            id::text as id, 
            COALESCE(name, 'ללא שם') as name, 
            email, 
            avatar_url, 
            parent_manager_id::text as parent_manager_id, 
            roles,
            level,
            COALESCE(salary, 0) as salary,
            COALESCE(seniority_start_date::text, CURRENT_DATE::text) as seniority_start_date,
            CASE WHEN email = 'navesarussi@gmail.com' THEN true ELSE false END as is_super_admin
          FROM hierarchy
          ORDER BY level, name
        `);
        allUsers = result.rows;
      } catch (error: any) {
        // If columns don't exist, use query without them
        if (error.message && error.message.includes('salary')) {
          console.warn('Salary/seniority columns not found, using fallback query');
          const result = await this.pool.query(`
            WITH RECURSIVE hierarchy AS (
              -- Base case: super admin (root)
              SELECT 
                id, name, email, avatar_url, parent_manager_id, roles,
                0::DECIMAL(10,2) as salary,
                CURRENT_DATE::DATE as seniority_start_date,
                0 as level,
                ARRAY[id] as path
              FROM user_profiles
              WHERE email = 'navesarussi@gmail.com'
              
              UNION ALL
              
              -- Recursive: all subordinates
              SELECT 
                u.id, u.name, u.email, u.avatar_url, u.parent_manager_id, u.roles,
                0::DECIMAL(10,2) as salary,
                CURRENT_DATE::DATE as seniority_start_date,
                h.level + 1,
                h.path || u.id
              FROM user_profiles u
              INNER JOIN hierarchy h ON u.parent_manager_id = h.id
              WHERE h.level < 10  -- Max depth to prevent infinite loops
            )
            SELECT 
              id::text as id, 
              COALESCE(name, 'ללא שם') as name, 
              email, 
              avatar_url, 
              parent_manager_id::text as parent_manager_id, 
              roles,
              level,
              0 as salary,
              CURRENT_DATE::text as seniority_start_date,
              CASE WHEN email = 'navesarussi@gmail.com' THEN true ELSE false END as is_super_admin
            FROM hierarchy
            ORDER BY level, name
          `);
          allUsers = result.rows;
        } else {
          throw error;
        }
      }

      // Build nested tree structure
      const buildTree = (parentId: string | null, level: number): any[] => {
        return allUsers
          .filter(user => {
            if (level === 0) {
              return user.email === 'navesarussi@gmail.com';
            }
            return user.parent_manager_id === parentId;
          })
          .map(user => ({
            id: user.id,
            name: user.name,
            email: user.email,
            avatar_url: user.avatar_url,
            level: user.level,
            isSuperAdmin: user.is_super_admin,
            isAdmin: Array.isArray(user.roles) && user.roles.includes('admin'),
            salary: user.salary || 0,
            seniority_start_date: user.seniority_start_date || new Date().toISOString().split('T')[0],
            children: buildTree(user.id, level + 1)
          }));
      };

      const tree = buildTree(null, 0);

      console.log(`🌳 Built hierarchy tree with ${allUsers.length} users`);

      return {
        success: true,
        data: tree,
        totalCount: allUsers.length
      };
    } catch (error) {
      console.error('Get full hierarchy tree error:', error);
      return { success: false, error: 'Failed to get hierarchy tree' };
    }
  }

  /**
   * Get direct subordinates and their sub-tree (hierarchy)
   * GET /api/users/:id/hierarchy
   */
  @Get(':id/hierarchy')
  async getUserHierarchy(@Param('id') id: string) {
    try {
      // Recursive CTE to get full hierarchy
      const { rows } = await this.pool.query(`
        WITH RECURSIVE subordinates AS (
          -- Base case: direct subordinates
          SELECT id, name, email, avatar_url, parent_manager_id, 1 as level
          FROM user_profiles
          WHERE parent_manager_id = $1
          
          UNION ALL
          
          -- Recursive member: subordinates of subordinates
          SELECT u.id, u.name, u.email, u.avatar_url, u.parent_manager_id, s.level + 1
          FROM user_profiles u
          INNER JOIN subordinates s ON u.parent_manager_id = s.id
        )
        SELECT * FROM subordinates ORDER BY level, name
      `, [id]);

      return { success: true, data: rows };
    } catch (error) {
      console.error('Get hierarchy error:', error);
      return { success: false, error: 'Failed to get hierarchy' };
    }
  }



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

      const PRE_APPROVED_ADMINS = [
        'mahalalel100@gmail.com',
        'matan7491@gmail.com',
        'ichai1306@gmail.com',
        'lianbh2004@gmail.com',
        'navesarussi@gmail.com',
        'karmacommunity2.0@gmail.com'
      ];

      const shouldBeAdmin = PRE_APPROVED_ADMINS.includes(normalizedEmail);
      const initialRoles = shouldBeAdmin ? ['user', 'admin'] : ['user'];

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
        initialRoles, // roles
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
        `SELECT id, email, name, phone, avatar_url, bio, city, country, interests, roles, settings, created_at, parent_manager_id
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
        parent_manager_id: createdUser[0].parent_manager_id || null,
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
                karma_points, join_date, is_active, last_active, parent_manager_id,
                city, country, interests, roles, settings, created_at
         FROM user_profiles WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [normalizedEmail]
      );

      if (rows.length === 0) {
        return { success: false, error: 'User not found' };
      }

      const user = rows[0];

      // Auto-grant admin role for pre-approved emails (Self-healing)
      const PRE_APPROVED_ADMINS = [
        'mahalalel100@gmail.com',
        'matan7491@gmail.com',
        'ichai1306@gmail.com',
        'lianbh2004@gmail.com',
        'navesarussi@gmail.com',
        'karmacommunity2.0@gmail.com'
      ];

      const shouldBeAdmin = PRE_APPROVED_ADMINS.includes(normalizedEmail);
      const currentRoles: string[] = user.roles || [];

      if (shouldBeAdmin && !currentRoles.includes('admin')) {
        await this.pool.query(
          `UPDATE user_profiles SET roles = array_append(roles, 'admin') WHERE id = $1`,
          [user.id]
        );
        user.roles = [...currentRoles, 'admin'];
      }

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
        parent_manager_id: user.parent_manager_id || null,
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
    try {
      console.log(`[UsersController] getUserById called with id: ${id}`);

      // Normalize email to lowercase for consistent lookup
      // This matches the normalization used in auth.controller.ts
      const normalizedId = id.includes('@')
        ? String(id).trim().toLowerCase()
        : id;

      console.log(`[UsersController] Normalized id: ${normalizedId}`);

      const cacheKey = `user_profile_${normalizedId}`;

      // Try to get from cache, but handle Redis errors gracefully
      let cached = null;
      try {
        cached = await this.redisCache.get(cacheKey);
        if (cached) {
          console.log(`[UsersController] Cache hit for ${normalizedId}`);
          return { success: true, data: cached };
        }
        console.log(`[UsersController] Cache miss for ${normalizedId}`);
      } catch (cacheError) {
        console.warn(`[UsersController] Redis cache error (non-fatal):`, cacheError);
        // Continue without cache - don't fail the request
      }

      // Use user_profiles table - support UUID, email, firebase_uid, or google_id lookups
      console.log(`[UsersController] Querying database for ${normalizedId}`);

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
            parent_manager_id,
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
        console.log(`[UsersController] Database query returned ${rows.length} rows`);
      } catch (error: any) {
        // If google_id column doesn't exist, try without it
        if (error.message && error.message.includes('google_id')) {
          console.log(`[UsersController] Retrying query without google_id column`);
          const result = await this.pool.query(`
            SELECT 
              id,
              email,
              COALESCE(name, 'ללא שם') as name,
              phone,
              COALESCE(avatar_url, '') as avatar_url,
              COALESCE(bio, '') as bio,
              parent_manager_id,
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
          console.log(`[UsersController] Retry query returned ${rows.length} rows`);
        } else {
          throw error;
        }
      }

      if (rows.length === 0) {
        console.log(`[UsersController] User not found for ${normalizedId}`);
        return { success: false, error: 'User not found' };
      }

      const user = rows[0];
      console.log(`[UsersController] User found: ${user.email} (${user.id})`);

      // Try to cache the result, but don't fail if Redis is down
      try {
        await this.redisCache.set(cacheKey, user, this.CACHE_TTL);
        console.log(`[UsersController] User cached successfully`);
      } catch (cacheError) {
        console.warn(`[UsersController] Failed to cache user (non-fatal):`, cacheError);
        // Continue - caching failure shouldn't fail the request
      }

      return { success: true, data: user };
    } catch (error: any) {
      console.error(`[UsersController] getUserById error for id ${id}:`, error);
      console.error(`[UsersController] Error stack:`, error?.stack);
      return {
        success: false,
        error: 'Failed to get user',
        details: error?.message || 'Unknown error'
      };
    }
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
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
      if (updateData.roles !== undefined) {
        // STATIC PROTECTION: Prevent modifying navesarussi@gmail.com roles
        if (existingUser.email?.toLowerCase() === 'navesarussi@gmail.com') {
          // Instead of throwing error, we just ignore the roles update for this user to be safe but not break other updates
          console.warn('Attempted to modify roles of Super Admin (navesarussi@gmail.com) - Ignoring role update.');
        } else {
          updateFields.push(`roles = $${paramCount++}::text[]`);
          updateValues.push(updateData.roles);
        }
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
      await this.redisCache.invalidatePattern('users_list*');

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
    @Query('offset') offset?: string,
    @Query('forceRefresh') forceRefresh?: string
  ) {
    // TODO: Implement proper cache key structure and versioning
    // TODO: Add cache invalidation strategy when users are updated
    // TODO: Implement cache warming for frequently accessed data
    const cacheKey = `users_list_${city || 'all'}_${search || ''}_${limit || '50'}_${offset || '0'}`;

    // Skip cache if forceRefresh is requested
    const shouldForceRefresh = forceRefresh === 'true' || forceRefresh === '1';

    if (!shouldForceRefresh) {
      const cached = await this.redisCache.get(cacheKey);
      if (cached) {
        console.log(`[getUsers] 📦 Returning cached data for key: ${cacheKey}`);
        return { success: true, data: cached };
      }
    } else {
      console.log(`[getUsers] 🔄 Force refresh requested, bypassing cache for key: ${cacheKey}`);
    }

    // Unified query: Get all users from both user_profiles and users (legacy) tables
    // טבלה מאוחדת: כל המשתמשים מ-user_profiles ו-users (legacy)
    const params: any[] = [];
    let paramCount = 0;

    // Build WHERE conditions for filtering
    let whereConditions = '';

    if (city) {
      paramCount++;
      whereConditions += ` AND u.city ILIKE $${paramCount}`;
      params.push(`%${city}%`);
    }

    if (search) {
      paramCount++;
      whereConditions += ` AND (u.name ILIKE $${paramCount} OR u.bio ILIKE $${paramCount} OR u.email ILIKE $${paramCount})`;
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
    // Includes manager details (name, email, avatar) via subquery
    const query = `
      SELECT 
        u.id::text as id,
        COALESCE(u.name, 'ללא שם') as name,
        COALESCE(u.avatar_url, '') as avatar_url,
        COALESCE(u.city, '') as city,
        COALESCE(u.karma_points, 0) as karma_points,
        COALESCE(u.last_active, u.updated_at) as last_active,
        COALESCE(u.total_donations_amount, 0) as total_donations_amount,
        COALESCE(u.total_volunteer_hours, 0) as total_volunteer_hours,
        COALESCE(u.join_date, u.created_at) as join_date,
        COALESCE(u.bio, '') as bio,
        COALESCE(u.roles, ARRAY['user']::text[]) as roles,
        u.email,
        u.is_active,
        u.created_at,
        u.parent_manager_id::text as parent_manager_id,
        (SELECT json_build_object(
          'id', m.id::text,
          'name', COALESCE(m.name, 'ללא שם'),
          'email', m.email,
          'avatar_url', COALESCE(m.avatar_url, '')
        ) FROM user_profiles m WHERE m.id = u.parent_manager_id) as manager_details
      FROM user_profiles u
      WHERE u.email IS NOT NULL AND u.email <> ''
        ${whereConditions}
      ORDER BY u.karma_points DESC, u.last_active DESC, u.join_date DESC
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
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
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
        console.log('❌ User not found for resolution:', { firebase_uid, google_id, email });
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

                    // Generate JWT tokens for the new user
                    const tokenPair = await this.jwtService.createTokenPair({
                      id: newUser[0].id,
                      email: newUser[0].email,
                      roles: newUser[0].roles || ['user'],
                    });

                    return {
                      success: true,
                      tokens: {
                        accessToken: tokenPair.accessToken,
                        refreshToken: tokenPair.refreshToken,
                        expiresIn: tokenPair.expiresIn,
                        refreshExpiresIn: tokenPair.refreshExpiresIn,
                      },
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

                      // Generate JWT tokens for the new user
                      const tokenPair = await this.jwtService.createTokenPair({
                        id: newUser[0].id,
                        email: newUser[0].email,
                        roles: newUser[0].roles || ['user'],
                      });

                      return {
                        success: true,
                        tokens: {
                          accessToken: tokenPair.accessToken,
                          refreshToken: tokenPair.refreshToken,
                          expiresIn: tokenPair.expiresIn,
                          refreshExpiresIn: tokenPair.refreshExpiresIn,
                        },
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

      // Log which identifier was used to find the user
      let resolvedBy = 'unknown';
      if (firebase_uid && user.firebase_uid === firebase_uid) {
        resolvedBy = 'firebase_uid';
      } else if (google_id && user.google_id === google_id) {
        resolvedBy = 'google_id';
      } else if (email && user.email?.toLowerCase() === email.toLowerCase()) {
        resolvedBy = 'email';
      }
      console.log(`✅ User resolved by ${resolvedBy}:`, { email: user.email, id: user.id });

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

      // Generate JWT tokens for authenticated session
      const tokenPair = await this.jwtService.createTokenPair({
        id: user.id,
        email: user.email,
        roles: user.roles || ['user'],
      });

      return {
        success: true,
        tokens: {
          accessToken: tokenPair.accessToken,
          refreshToken: tokenPair.refreshToken,
          expiresIn: tokenPair.expiresIn,
          refreshExpiresIn: tokenPair.refreshExpiresIn,
        },
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
