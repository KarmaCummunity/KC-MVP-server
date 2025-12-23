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
import { ItemsService } from '../items/items.service';

type TaskStatus = 'open' | 'in_progress' | 'done' | 'archived';
type TaskPriority = 'low' | 'medium' | 'high';

@Controller('/api/tasks')
export class TasksController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly redisCache: RedisCacheService,
    private readonly userResolutionService: UserResolutionService,
    private readonly itemsService: ItemsService,
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
   * Ensure posts table exists with correct schema, create/migrate if needed
   * This is a fallback in case schema.sql wasn't run or table has legacy structure
   */
  private async ensurePostsTable() {
    try {
      // Check if posts table exists and has correct structure
      const tableCheck = await this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = 'posts'
        ) AS exists;
      `);

      if (tableCheck.rows[0]?.exists) {
        // Check if it has the correct structure (author_id column)
        const columnCheck = await this.pool.query(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'posts' AND column_name = 'author_id'
          ) AS exists;
        `);

        if (!columnCheck.rows[0]?.exists) {
          // Legacy table exists with wrong structure - drop and recreate
          console.log('⚠️  Detected legacy posts table structure - recreating with correct schema');
          await this.pool.query('DROP TABLE IF EXISTS posts CASCADE;');
        } else {
          // Table exists with correct structure
          return;
        }
      }

      // Create posts table with correct schema
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS posts (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          author_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
          task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          images TEXT[],
          likes INTEGER DEFAULT 0,
          comments INTEGER DEFAULT 0,
          post_type VARCHAR(50) DEFAULT 'task_completion',
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create indexes
      const indexes = [
        'idx_posts_author_id ON posts(author_id)',
        'idx_posts_task_id ON posts(task_id)',
        'idx_posts_created_at ON posts(created_at DESC)',
        'idx_posts_post_type ON posts(post_type)'
      ];

      for (const idx of indexes) {
        try {
          await this.pool.query(`CREATE INDEX IF NOT EXISTS ${idx};`);
        } catch (e) {
          console.log(`⚠️ Skipping index ${idx}`);
        }
      }

      // Create trigger for updated_at
      try {
        await this.pool.query(`
          DROP TRIGGER IF EXISTS update_posts_updated_at ON posts;
          CREATE TRIGGER update_posts_updated_at 
            BEFORE UPDATE ON posts 
            FOR EACH ROW 
            EXECUTE FUNCTION update_updated_at_column();
        `);
      } catch (e) {
        console.log('⚠️ Could not create update_posts_updated_at trigger (function might not exist)');
      }

      console.log('✅ Posts table ensured with correct schema');
    } catch (error) {
      console.error('❌ Failed to ensure posts table:', error);
      // Don't throw - allow code to continue, but log the error
    }
  }

  /**
   * Ensure tasks table exists, create it if missing
   * This is a fallback in case schema.sql wasn't run
   */
  private async ensureTasksTable() {
    try {
      // 1. Ensure TASKS table exists (Idempotent)
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
          created_by UUID, -- REFERENCES user_profiles(id)
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // 2. Ensure INDEXES (Idempotent)
      // Some simple manual index checks
      const indexes = [
        'idx_tasks_status ON tasks (status)',
        'idx_tasks_priority ON tasks (priority)',
        'idx_tasks_category ON tasks (category)',
        'idx_tasks_due_date ON tasks (due_date)',
        'idx_tasks_created_at ON tasks (created_at)',
        'idx_tasks_assignees_gin ON tasks USING GIN (assignees)',
        'idx_tasks_tags_gin ON tasks USING GIN (tags)'
      ];
      for (const idx of indexes) {
        try {
          await this.pool.query(`CREATE INDEX IF NOT EXISTS ${idx}`);
        } catch (e) { /* ignore */ }
      }

      // 3. Ensure NOTIFICATIONS table (Idempotent)
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            data JSONB NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (user_id, item_id)
        );
      `);

    } catch (error) {
      console.error('❌ Error ensuring tables (non-fatal):', error);
      // Do not throw. If standard tables exist, we can proceed.
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
    @Query('assignee') assignee?: string,
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
      const cacheKey = `tasks_list_${status || 'all'}_${priority || 'all'}_${category || 'all'}_${assignee || 'all'}_${searchQuery || 'all'}_${limit}_${offset}`;

      // Temporarily disable cache to fix "disappearing task" issue
      console.log('⚠️ Cache disabled for listTasks debugging');
      /* 
      // Try to get from cache (but don't fail if Redis is unavailable)
      let cached = null;
      try {
        cached = await this.redisCache.get(cacheKey);
      } catch (cacheError) {
        console.warn('Redis cache error (non-fatal):', cacheError);
      }

      if (cached) {
        console.log('✅ Returning cached tasks list');
        return { success: true, data: cached };
      }
      */

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

      if (assignee) {
        // Assume assignee is UUID for now. If email, we'd need to resolve it.
        // Ideally we resolve it to be safe.
        // But for performance, let's assume UUID if it looks like one.
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let assigneeUuid = assignee;

        if (!uuidRegex.test(assignee)) {
          // Try to resolve if not UUID (e.g. email)
          const resolved = await this.resolveUserIdToUUID(assignee);
          if (resolved) {
            console.log(`👤 Resolved list filter assignee ${assignee} -> ${resolved}`);
            assigneeUuid = resolved;
          } else {
            console.warn(`⚠️ Could not resolve list filter assignee: ${assignee}`);
          }
        }

        params.push(assigneeUuid);
        // "assigneeUuid = ANY(assignees)" checks if uuid is in the array
        // Cast both sides to UUID to ensure type compatibility
        filters.push(`$${params.length}::UUID = ANY(assignees::UUID[])`);
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
        SELECT 
            t.id, t.title, t.description, t.status, t.priority, t.category, t.due_date, t.assignees, t.tags, t.checklist, t.parent_task_id, t.created_at, t.updated_at,
            (SELECT json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'avatar_url', u.avatar_url) 
             FROM user_profiles u 
             WHERE u.id::text = t.created_by::text 
                OR u.firebase_uid = t.created_by::text
                OR u.google_id = t.created_by::text
             LIMIT 1) as creator_details,
            (SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'avatar_url', u.avatar_url)) 
             FROM user_profiles u WHERE u.id = ANY(t.assignees::UUID[])) as assignees_details
        FROM tasks t
        ${where}
        ORDER BY 
          CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC,
          status ASC,
          created_at DESC
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
      `;
      params.push(limit, offset);

      console.log(`🚀 Executing LIST SQL:`, sql.replace(/\s+/g, ' ').trim());
      console.log(`params:`, params);

      const { rows } = await this.pool.query(sql, params);
      console.log(`✅ Found ${rows.length} tasks`);

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
        `SELECT 
            t.id, t.title, t.description, t.status, t.priority, t.category, t.due_date, t.assignees, t.tags, t.checklist, t.created_by, t.parent_task_id, t.created_at, t.updated_at,
            (SELECT json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'avatar_url', u.avatar_url) 
             FROM user_profiles u 
             WHERE u.id::text = t.created_by::text 
                OR u.firebase_uid = t.created_by::text
                OR u.google_id = t.created_by::text
             LIMIT 1) as creator_details,
            (SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'avatar_url', u.avatar_url)) 
             FROM user_profiles u WHERE u.id = ANY(t.assignees::UUID[])) as assignees_details
         FROM tasks t WHERE t.id = $1`,
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
        checkList = null,
        created_by = null,
        parent_task_id = null,
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

      console.log(`📝 POST /api/tasks payload:`, JSON.stringify(body));

      // Resolve created_by to UUID if provided (Declared here to avoid used-before-assigned error)
      let createdByUuid: string | null = null;
      if (created_by) {
        const resolutionStart = Date.now();
        createdByUuid = await this.resolveUserIdToUUID(created_by);
        console.log(`👤 Resolved created_by ${created_by} to ${createdByUuid} in ${Date.now() - resolutionStart}ms`);
        if (!createdByUuid) {
          console.warn(`⚠️ Could not resolve created_by user: ${created_by}`);
        }
      } else {
        console.log(`👤 No created_by provided in payload`);
      }

      console.log(`👤 Final createdByUuid:`, createdByUuid);


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
        console.log('📧 Processing assigneesEmails (POST):', assigneesEmails);
        const emailList = assigneesEmails.filter((e) => typeof e === 'string' && e.trim());
        if (emailList.length > 0) {
          const emailQuery = `
            SELECT id FROM user_profiles 
            WHERE email = ANY($1::TEXT[])
          `;
          const { rows: userRows } = await this.pool.query(emailQuery, [emailList]);
          assigneeUUIDs = userRows.map((row) => row.id);
          console.log('📧 Resolved emails to UUIDs:', assigneeUUIDs);
        }
      }
      // Otherwise, use assignees if provided (should be UUIDs)
      else if (Array.isArray(assignees) && assignees.length > 0) {
        console.log('👥 Processing assignees (POST):', assignees);
        assigneeUUIDs = assignees;
      }

      // created_by already resolved above


      const sql = `
        INSERT INTO tasks (title, description, status, priority, category, due_date, assignees, tags, checklist, created_by, parent_task_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7::UUID[], $8::TEXT[], $9::JSONB, $10::UUID, $11::UUID)
        RETURNING id, title, description, status, priority, category, due_date, assignees, tags, checklist, created_by, parent_task_id, created_at, updated_at
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
        parent_task_id || null,
      ];

      console.log(`🚀 Executing INSERT SQL with params:`, JSON.stringify(params));

      const { rows } = await this.pool.query(sql, params);
      const newTask = rows[0];
      console.log('✅ Task inserted successfully:', newTask.id);

      // NOTIFICATION: Notify assignees
      if (assigneeUUIDs.length > 0) {
        const timestamp = new Date().toISOString();
        console.log(`🔔 Preparing to notify ${assigneeUUIDs.length} assignees...`);

        for (const assigneeId of assigneeUUIDs) {
          try {
            // Check if notifications table exists first (quick safeguard)
            // Actually, just try to create and catch error

            console.log(`🔔 Sending new task notification to ${assigneeId}`); // Log BEFORE attempt

            await this.itemsService.create(
              'notifications',
              assigneeId,
              require('crypto').randomUUID(),
              {
                title: 'משימה חדשה',
                body: `הוקצתה לך משימה חדשה: ${newTask.title}`,
                type: 'system',
                timestamp,
                read: false,
                userId: assigneeId,
                data: { taskId: newTask.id }
              }
            );
            console.log(`✅ Notification sent to ${assigneeId}`);
          } catch (itemError) {
            console.error(`❌ Failed to create notification for ${assigneeId}. It is likely the 'notifications' table does not exist.`, itemError);
            // Verify table existence - if it fails here, we should probably auto-create it or warn loudly
          }
        }

        // AUTO-POST: Create posts for task assignment
        // Ensure posts table exists before creating posts
        await this.ensurePostsTable();
        
        console.log(`📝 Creating posts for ${assigneeUUIDs.length} assignees...`);
        for (const assigneeId of assigneeUUIDs) {
          try {
            await this.pool.query(`
              INSERT INTO posts (author_id, task_id, title, description, post_type)
              VALUES ($1, $2, $3, $4, 'task_assignment')
            `, [
              assigneeId,
              newTask.id,
              `משימה חדשה: ${newTask.title}`,
              newTask.description 
                ? `הוקצתה לך משימה חדשה: ${newTask.description}`
                : `הוקצתה לך משימה חדשה: ${newTask.title}`
            ]);
            console.log(`✅ Post created for assignee ${assigneeId}`);
          } catch (postError) {
            console.error(`❌ Failed to create post for assignee ${assigneeId}:`, postError);
            // Don't fail the request, just log
          }
        }
      }

      // Clear task list caches (non-blocking)
      this.clearTaskCaches().catch((err) => {
        console.warn('Error clearing caches after task creation:', err);
      });

      return { success: true, data: newTask };
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

      // Fetch OLD task to compare assignees
      const oldTaskRes = await this.pool.query('SELECT assignees FROM tasks WHERE id = $1', [id]);
      const oldAssignees: string[] = oldTaskRes.rows[0]?.assignees || [];

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

      console.log(`📝 PATCH /api/tasks/${id} payload:`, JSON.stringify(body));

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
        console.log('📧 Processing assigneesEmails update');
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
      } else if ('assignees' in body) {
        // Handle assignees update explicitly if key exists
        console.log('👥 Processing assignees update:', body.assignees);
        if (Array.isArray(body.assignees)) {
          assigneeUUIDs = body.assignees;
          shouldUpdateAssignees = true;
        }
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

      if (shouldUpdateAssignees) {
        console.log('👥 Updating assignees to set:', assigneeUUIDs);
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

      console.log('🚀 Executing SQL:', sql, params);

      const { rows } = await this.pool.query(sql, params);
      if (!rows.length) {
        return { success: false, error: 'Task not found' };
      }

      const updatedTask = rows[0];

      // CHECK NOTIFICATIONS
      if (shouldUpdateAssignees) {
        const newAssignees = updatedTask.assignees || [];
        // Handle case where oldAssignees might be null/undefined or contains nulls
        const safeOldAssignees = (oldAssignees || []).filter(Boolean);
        const addedAssignees = newAssignees.filter((uid: string) => !safeOldAssignees.includes(uid));

        console.log('🔔 Notification check:', {
          safeOld: safeOldAssignees,
          new: newAssignees,
          added: addedAssignees
        });

        if (addedAssignees.length > 0) {
          const timestamp = new Date().toISOString();
          console.log(`🔔 Found ${addedAssignees.length} new assignees to notify...`);

          for (const assigneeId of addedAssignees) {
            try {
              console.log(`🔔 Sending notification to ${assigneeId}`);

              await this.itemsService.create(
                'notifications',
                assigneeId,
                require('crypto').randomUUID(),
                {
                  title: 'משימה חדשה',
                  body: `הוקצתה לך משימה חדשה: ${updatedTask.title}`,
                  type: 'system',
                  timestamp,
                  read: false,
                  userId: assigneeId,
                  data: { taskId: updatedTask.id }
                }
              );
              console.log(`✅ Notification sent to ${assigneeId}`);
            } catch (err) {
              console.error(`❌ Failed to create notification for ${assigneeId}`, err);
            }
          }

          // AUTO-POST: Create posts for newly assigned users
          // Ensure posts table exists before creating posts
          await this.ensurePostsTable();
          
          console.log(`📝 Creating posts for ${addedAssignees.length} newly assigned users...`);
          for (const assigneeId of addedAssignees) {
            try {
              await this.pool.query(`
                INSERT INTO posts (author_id, task_id, title, description, post_type)
                VALUES ($1, $2, $3, $4, 'task_assignment')
              `, [
                assigneeId,
                updatedTask.id,
                `משימה חדשה: ${updatedTask.title}`,
                updatedTask.description 
                  ? `הוקצתה לך משימה חדשה: ${updatedTask.description}`
                  : `הוקצתה לך משימה חדשה: ${updatedTask.title}`
              ]);
              console.log(`✅ Post created for newly assigned user ${assigneeId}`);
            } catch (postError) {
              console.error(`❌ Failed to create post for assignee ${assigneeId}:`, postError);
              // Don't fail the request, just log
            }
          }
        }
      }

      // Clear task caches (non-blocking)
      this.redisCache.delete(`task_${id}`).catch((err) => {
        console.warn('Error deleting task cache:', err);
      });
      this.clearTaskCaches().catch((err) => {
        console.warn('Error clearing caches after task update:', err);
      });

      if (rows.length > 0 && body.status === 'done') {
        const task = rows[0];
        // AUTO-POST: Create posts for task completion
        // Ensure posts table exists before creating posts
        await this.ensurePostsTable();
        
        console.log(`📝 Creating completion posts for task ${task.id}...`);
        try {
          // 1. Post for creator
          if (task.created_by) {
            await this.pool.query(`
              INSERT INTO posts (author_id, task_id, title, description, post_type)
              VALUES ($1, $2, $3, $4, 'task_completion')
            `, [
              task.created_by, 
              task.id, 
              `משימה הושלמה: ${task.title}`, 
              task.description 
                ? `המשימה "${task.title}" הושלמה בהצלחה! ${task.description}`
                : `המשימה "${task.title}" הושלמה בהצלחה!`
            ]);
            console.log(`✅ Completion post created for creator ${task.created_by}`);
          }

          // 2. Post for assignees
          if (task.assignees && task.assignees.length > 0) {
            for (const assigneeId of task.assignees) {
              if (assigneeId !== task.created_by) { // Avoid duplicate if assigned to creator
                await this.pool.query(`
                  INSERT INTO posts (author_id, task_id, title, description, post_type)
                  VALUES ($1, $2, $3, $4, 'task_completion')
                `, [
                  assigneeId, 
                  task.id, 
                  `ביצעתי משימה: ${task.title}`, 
                  task.description 
                    ? `השלמתי את המשימה "${task.title}" בהצלחה! ${task.description}`
                    : `השלמתי את המשימה "${task.title}" בהצלחה!`
                ]);
                console.log(`✅ Completion post created for assignee ${assigneeId}`);
              }
            }
          }
        } catch (postError) {
          console.error('❌ Failed to create auto-posts for task completion:', postError);
          // Don't fail the request, just log
        }
      }

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


