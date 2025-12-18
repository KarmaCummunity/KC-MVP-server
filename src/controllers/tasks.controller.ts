// File overview:
// - Purpose: CRUD עבור משימות קבוצתיות למנהל האפליקציה
// - Routes: /api/tasks (GET, POST), /api/tasks/:id (GET, PATCH, DELETE)
// - Storage: PostgreSQL טבלת tasks (schema.sql)
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { RedisCacheService } from '../redis/redis-cache.service';
import { UserResolutionService } from '../services/user-resolution.service';

type TaskStatus = 'open' | 'in_progress' | 'done' | 'archived';
type TaskPriority = 'low' | 'medium' | 'high';

@Controller('/api/tasks')
export class TasksController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly redisCache: RedisCacheService,
    private readonly userResolutionService: UserResolutionService,
  ) { }

  /**
   * Resolve any user identifier (email, firebase_uid, google_id, UUID string) to UUID
   * Now delegates to UserResolutionService for consistency
   */
  private async resolveUserIdToUUID(userId: string): Promise<string | null> {
    return this.userResolutionService.resolveUserId(userId, {
      throwOnNotFound: false,
      cacheResult: true,
      logError: false
    });
  }

  /**
   * Ensure tasks table exists, create it if missing
   * This is a fallback in case schema.sql wasn't run
   */
  private async ensureTasksTable() {
    try {
      // Check if table exists
      const checkTable = await this.pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'tasks'
        );
      `);

      const tableExists = checkTable.rows[0].exists;
      let needsRecreation = false;

      // If table exists, verify it has the required columns
      if (tableExists) {
        const checkColumns = await this.pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'tasks'
          AND column_name IN ('id', 'title', 'description', 'status', 'priority')
        `);

        const requiredColumns = ['id', 'title', 'description', 'status', 'priority'];
        const existingColumns = checkColumns.rows.map((r: any) => r.column_name);
        const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));

        if (missingColumns.length > 0) {
          console.warn(`⚠️ Tasks table exists but missing columns: ${missingColumns.join(', ')}. Dropping and recreating...`);
          // Drop and recreate if columns are missing
          await this.pool.query('DROP TABLE IF EXISTS tasks CASCADE');
          needsRecreation = true;
        } else {
          // Table exists with all required columns
          return;
        }
      }

      // Create table if it doesn't exist or was dropped
      if (!tableExists || needsRecreation) {
        console.warn('⚠️ Tasks table not found, creating it...');
        console.log('📋 Attempting to create tasks table in production...');

        try {
          // Create extension (may fail if no permissions, but continue anyway)
          try {
            console.log('📦 Creating uuid-ossp extension...');
            await this.pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
            console.log('✅ uuid-ossp extension ready');
          } catch (extError) {
            console.warn('⚠️ Could not create uuid-ossp extension (may already exist or no permissions):', extError);
            // Continue - extension might already exist
          }

          // Create the table
          console.log('📋 Creating tasks table...');
          await this.pool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
              id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
              title VARCHAR(255) NOT NULL,
              description TEXT,
              status VARCHAR(20) NOT NULL DEFAULT 'open',
              priority VARCHAR(10) NOT NULL DEFAULT 'medium',
              category VARCHAR(50),
              due_date TIMESTAMPTZ,
              assignees UUID[] DEFAULT ARRAY[]::UUID[],
              tags TEXT[] DEFAULT ARRAY[]::TEXT[],
              checklist JSONB,
              created_by UUID, -- REFERENCES user_profiles(id), -- UUID to match user_profiles.id type
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            )
          `);
          console.log('✅ Tasks table CREATE statement executed');

          // Create indexes
          console.log('📊 Creating indexes...');
          await this.pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)');
          await this.pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks (priority)');
          await this.pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks (category)');
          await this.pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks (due_date)');
          await this.pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks (created_at)');
          await this.pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_assignees_gin ON tasks USING GIN (assignees)');
          await this.pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_tags_gin ON tasks USING GIN (tags)');
          console.log('✅ Indexes created');

          // Create trigger function if it doesn't exist
          console.log('⚙️ Creating trigger function...');
          await this.pool.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
              NEW.updated_at = NOW();
              RETURN NEW;
            END;
            $$ language 'plpgsql'
          `);

          // Create trigger
          await this.pool.query('DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks');
          await this.pool.query(`
            CREATE TRIGGER update_tasks_updated_at 
            BEFORE UPDATE ON tasks 
            FOR EACH ROW 
            EXECUTE FUNCTION update_updated_at_column()
          `);
          console.log('✅ Trigger created');

          // Verify table was created - wait a bit and check again
          console.log('🔍 Verifying table creation...');
          await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for DB to sync

          const verifyTable = await this.pool.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.tables 
              WHERE table_schema = 'public' 
              AND table_name = 'tasks'
            );
          `);

          if (verifyTable.rows[0].exists) {
            console.log('✅✅✅ Tasks table created and verified successfully!');
          } else {
            console.error('❌❌❌ Tasks table verification failed - table does not exist after creation attempt');
            throw new Error('Tasks table creation failed - table does not exist after creation attempt. Check database permissions.');
          }
        } catch (createError) {
          console.error('❌ Failed to create tasks table:', createError);
          // Re-throw to let caller know table creation failed
          throw new Error(`Failed to create tasks table: ${createError instanceof Error ? createError.message : String(createError)}`);
        }
      }
    } catch (error) {
      console.error('❌ Error ensuring tasks table:', error);
      // Re-throw so the actual query will fail with a clear error
      throw error;
    }
  }

  /**
   * List tasks with filtering and pagination
   * Cache TTL: 10 minutes (tasks change moderately frequently)
   */
  @Get()
  async listTasks(
    @Query('status') status?: TaskStatus,
    @Query('priority') priority?: TaskPriority,
    @Query('category') category?: string,
    @Query('q') searchQuery?: string,
    @Query('limit') limitParam?: string,
    @Query('offset') offsetParam?: string,
  ) {
    try {
      // Ensure table exists before querying
      await this.ensureTasksTable();

      // Parse limit and offset - handle 0 correctly
      const limitNum = limitParam ? parseInt(String(limitParam), 10) : 100;
      const offsetNum = offsetParam ? parseInt(String(offsetParam), 10) : 0;
      const limit = Math.min(Math.max(isNaN(limitNum) ? 100 : limitNum, 1), 500);
      const offset = Math.max(isNaN(offsetNum) ? 0 : offsetNum, 0);

      // Build cache key from query parameters (include search query if present)
      const cacheKey = `tasks_list_${status || 'all'}_${priority || 'all'}_${category || 'all'}_${searchQuery || 'all'}_${limit}_${offset}`;

      // Try to get from cache (but don't fail if Redis is unavailable)
      let cached = null;
      try {
        cached = await this.redisCache.get(cacheKey);
      } catch (cacheError) {
        console.warn('Redis cache error (non-fatal):', cacheError);
      }

      if (cached) {
        return { success: true, data: cached };
      }

      const filters: string[] = [];
      const params: any[] = [];

      if (status) {
        params.push(status);
        filters.push(`status = $${params.length}`);
      }

      if (priority) {
        params.push(priority);
        filters.push(`priority = $${params.length}`);
      }

      if (category) {
        params.push(category);
        filters.push(`category = $${params.length}`);
      }

      // Add text search if query parameter is provided
      if (searchQuery && searchQuery.trim()) {
        const searchTerm = `%${searchQuery.trim()}%`;
        params.push(searchTerm);
        const searchParamIndex = params.length;
        filters.push(`(title ILIKE $${searchParamIndex} OR description ILIKE $${searchParamIndex})`);
      }

      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

      const sql = `
        SELECT id, title, description, status, priority, category, due_date, assignees, tags, checklist, created_by, created_at, updated_at
        FROM tasks
        ${where}
        ORDER BY 
          CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC,
          status ASC,
          created_at DESC
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
      `;
      params.push(limit, offset);

      const { rows } = await this.pool.query(sql, params);

      // Try to cache the result (but don't fail if Redis is unavailable)
      try {
        await this.redisCache.set(cacheKey, rows, 10 * 60);
      } catch (cacheError) {
        console.warn('Redis cache set error (non-fatal):', cacheError);
      }

      return { success: true, data: rows };
    } catch (error) {
      console.error('Error listing tasks:', error);

      // Check if error is about missing table/columns
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('does not exist') || errorMessage.includes('column')) {
        return {
          success: false,
          error: 'Database table structure issue. Please contact administrator or check server logs.',
        };
      }

      return {
        success: false,
        error: errorMessage || 'Failed to list tasks',
      };
    }
  }

  /**
   * Manual endpoint to create tasks table
   * Useful for production when automatic creation fails
   * GET /api/tasks/init-table
   */
  @Get('init-table')
  async initTasksTable() {
    try {
      await this.ensureTasksTable();
      return {
        success: true,
        message: 'Tasks table initialized successfully'
      };
    } catch (error) {
      console.error('Failed to initialize tasks table:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to initialize tasks table',
      };
    }
  }

  /**
   * Get a single task by ID
   * Cache TTL: 15 minutes
   */
  @Get(':id')
  async getTask(@Param('id') id: string) {
    try {
      // Ensure table exists before querying
      await this.ensureTasksTable();

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return { success: false, error: 'Invalid task ID format' };
      }

      const cacheKey = `task_${id}`;

      // Try to get from cache (but don't fail if Redis is unavailable)
      let cached = null;
      try {
        cached = await this.redisCache.get(cacheKey);
      } catch (cacheError) {
        console.warn('Redis cache error (non-fatal):', cacheError);
      }

      if (cached) {
        return { success: true, data: cached };
      }

      const { rows } = await this.pool.query(
        `SELECT id, title, description, status, priority, category, due_date, assignees, tags, checklist, created_by, created_at, updated_at
         FROM tasks WHERE id = $1`,
        [id],
      );
      if (!rows.length) {
        return { success: false, error: 'Task not found' };
      }

      // Try to cache the result (but don't fail if Redis is unavailable)
      try {
        await this.redisCache.set(cacheKey, rows[0], 15 * 60);
      } catch (cacheError) {
        console.warn('Redis cache set error (non-fatal):', cacheError);
      }

      return { success: true, data: rows[0] };
    } catch (error) {
      console.error('Error getting task:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get task',
      };
    }
  }

  @Post()
  async createTask(@Body() body: any) {
    try {
      // Ensure table exists before inserting
      await this.ensureTasksTable();

      const {
        title,
        description = null,
        status = 'open',
        priority = 'medium',
        category = null,
        due_date = null,
        assignees = [],
        assigneesEmails = [],
        tags = [],
        checklist = null,
        created_by = null,
      } = body || {};

      if (!title || typeof title !== 'string' || !title.trim()) {
        return { success: false, error: 'title is required and cannot be empty' };
      }

      // Validate status
      if (status && !['open', 'in_progress', 'done', 'archived'].includes(status)) {
        return { success: false, error: 'Invalid status value' };
      }

      // Validate priority
      if (priority && !['low', 'medium', 'high'].includes(priority)) {
        return { success: false, error: 'Invalid priority value' };
      }

      // Validate and parse due_date if provided
      let parsedDueDate = null;
      if (due_date) {
        if (typeof due_date === 'string') {
          const date = new Date(due_date);
          if (isNaN(date.getTime())) {
            return { success: false, error: 'Invalid due_date format' };
          }
          parsedDueDate = date.toISOString();
        } else {
          parsedDueDate = due_date;
        }
      }

      // Convert emails to UUIDs if assigneesEmails is provided
      let assigneeUUIDs: string[] = [];

      // If assigneesEmails is provided (array of emails), convert to UUIDs
      if (Array.isArray(assigneesEmails) && assigneesEmails.length > 0) {
        const emailList = assigneesEmails.filter((e) => typeof e === 'string' && e.trim());
        if (emailList.length > 0) {
          const emailQuery = `
            SELECT id FROM user_profiles 
            WHERE email = ANY($1::TEXT[])
          `;
          const { rows: userRows } = await this.pool.query(emailQuery, [emailList]);
          assigneeUUIDs = userRows.map((row) => row.id);
        }
      }
      // Otherwise, use assignees if provided (should be UUIDs)
      else if (Array.isArray(assignees) && assignees.length > 0) {
        assigneeUUIDs = assignees;
      }

      // Resolve created_by to UUID if provided
      let createdByUuid: string | null = null;
      if (created_by) {
        createdByUuid = await this.resolveUserIdToUUID(created_by);
        if (!createdByUuid) {
          console.warn(`⚠️ Could not resolve created_by user: ${created_by}`);
        }
      }

      const sql = `
        INSERT INTO tasks (title, description, status, priority, category, due_date, assignees, tags, checklist, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7::UUID[], $8::TEXT[], $9::JSONB, $10::UUID)
        RETURNING id, title, description, status, priority, category, due_date, assignees, tags, checklist, created_by, created_at, updated_at
      `;
      const params = [
        title.trim(),
        description,
        status,
        priority,
        category,
        parsedDueDate,
        assigneeUUIDs,
        Array.isArray(tags) ? tags : [],
        checklist,
        createdByUuid,
      ];

      const { rows } = await this.pool.query(sql, params);

      // Clear task list caches (non-blocking)
      this.clearTaskCaches().catch((err) => {
        console.warn('Error clearing caches after task creation:', err);
      });

      return { success: true, data: rows[0] };
    } catch (error) {
      console.error('Error creating task:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create task'
      };
    }
  }

  @Patch(':id')
  async updateTask(@Param('id') id: string, @Body() body: any) {
    try {
      // Ensure table exists before updating
      await this.ensureTasksTable();

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return { success: false, error: 'Invalid task ID format' };
      }

      // Validate status if provided
      if (body.status && !['open', 'in_progress', 'done', 'archived'].includes(body.status)) {
        return { success: false, error: 'Invalid status value' };
      }

      // Validate priority if provided
      if (body.priority && !['low', 'medium', 'high'].includes(body.priority)) {
        return { success: false, error: 'Invalid priority value' };
      }

      // Validate and parse due_date if provided
      let parsedDueDate = null;
      if (body.due_date !== undefined && body.due_date !== null) {
        if (typeof body.due_date === 'string') {
          const date = new Date(body.due_date);
          if (isNaN(date.getTime())) {
            return { success: false, error: 'Invalid due_date format' };
          }
          parsedDueDate = date.toISOString();
        } else {
          parsedDueDate = body.due_date;
        }
      }

      // Build partial update dynamically
      const allowed = [
        'title',
        'description',
        'status',
        'priority',
        'category',
        'due_date',
        'assignees',
        'assigneesEmails',
        'tags',
        'checklist',
      ] as const;
      const sets: string[] = [];
      const params: any[] = [];

      // Handle assigneesEmails conversion to UUIDs if provided
      let shouldUpdateAssignees = false;
      let assigneeUUIDs: string[] = [];

      if ('assigneesEmails' in body && Array.isArray(body.assigneesEmails)) {
        const emailList = body.assigneesEmails.filter((e: any) => typeof e === 'string' && e.trim());
        if (emailList.length > 0) {
          const emailQuery = `
            SELECT id FROM user_profiles 
            WHERE email = ANY($1::TEXT[])
          `;
          const { rows: userRows } = await this.pool.query(emailQuery, [emailList]);
          assigneeUUIDs = userRows.map((row) => row.id);
        }
        shouldUpdateAssignees = true;
      } else if ('assignees' in body && Array.isArray(body.assignees)) {
        assigneeUUIDs = body.assignees;
        shouldUpdateAssignees = true;
      }

      // Build SET clause
      for (const key of allowed) {
        if (key === 'assignees' || key === 'assigneesEmails') {
          // Skip, handled above
          continue;
        }

        if (key === 'due_date') {
          // Handle due_date separately with parsed value
          if (body.due_date !== undefined) {
            params.push(parsedDueDate);
            sets.push(`due_date = $${params.length}`);
          }
          continue;
        }

        if (key in body) {
          params.push(
            key === 'tags'
              ? (Array.isArray(body[key]) ? body[key] : [])
              : body[key],
          );
          const idx = params.length;
          if (key === 'tags') {
            sets.push(`tags = $${idx}::TEXT[]`);
          } else if (key === 'checklist') {
            sets.push(`checklist = $${idx}::JSONB`);
          } else {
            sets.push(`${key} = $${idx}`);
          }
        }
      }

      // Add assignees if needed
      if (shouldUpdateAssignees) {
        params.push(assigneeUUIDs);
        sets.push(`assignees = $${params.length}::UUID[]`);
      }

      if (!sets.length) {
        return { success: false, error: 'No valid fields to update' };
      }

      params.push(id);
      const sql = `
        UPDATE tasks SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length}
        RETURNING id, title, description, status, priority, category, due_date, assignees, tags, checklist, created_by, created_at, updated_at
      `;

      const { rows } = await this.pool.query(sql, params);
      if (!rows.length) {
        return { success: false, error: 'Task not found' };
      }

      // Clear task caches (non-blocking)
      this.redisCache.delete(`task_${id}`).catch((err) => {
        console.warn('Error deleting task cache:', err);
      });
      this.clearTaskCaches().catch((err) => {
        console.warn('Error clearing caches after task update:', err);
      });

      return { success: true, data: rows[0] };
    } catch (error) {
      console.error('Error updating task:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update task'
      };
    }
  }

  @Delete(':id')
  async deleteTask(@Param('id') id: string) {
    try {
      // Ensure table exists before deleting
      await this.ensureTasksTable();

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return { success: false, error: 'Invalid task ID format' };
      }

      const { rowCount } = await this.pool.query('DELETE FROM tasks WHERE id = $1', [id]);
      if (!rowCount) {
        return { success: false, error: 'Task not found' };
      }

      // Try to clear task caches (but don't fail if Redis is unavailable)
      try {
        await this.redisCache.delete(`task_${id}`);
        await this.clearTaskCaches();
      } catch (cacheError) {
        console.warn('Redis cache delete error (non-fatal):', cacheError);
      }

      return { success: true, message: 'Task deleted' };
    } catch (error) {
      console.error('Error deleting task:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete task',
      };
    }
  }

  /**
   * Clear all task-related caches
   * Called after create/update/delete operations to ensure data consistency
   */
  private async clearTaskCaches() {
    try {
      await this.redisCache.invalidatePattern('tasks_list_*');
    } catch (cacheError) {
      console.warn('Redis cache invalidation error (non-fatal):', cacheError);
    }
  }

}


