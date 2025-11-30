// File overview:
// - Purpose: CRUD עבור משימות קבוצתיות למנהל האפליקציה
// - Routes: /api/tasks (GET, POST), /api/tasks/:id (GET, PATCH, DELETE)
// - Storage: PostgreSQL טבלת tasks (schema.sql)
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { RedisCacheService } from '../redis/redis-cache.service';

type TaskStatus = 'open' | 'in_progress' | 'done' | 'archived';
type TaskPriority = 'low' | 'medium' | 'high';

@Controller('/api/tasks')
export class TasksController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly redisCache: RedisCacheService,
  ) {}

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
      const limit = Math.min(Math.max(parseInt(String(limitParam || '100'), 10) || 100, 1), 500);
      const offset = Math.max(parseInt(String(offsetParam || '0'), 10) || 0, 0);

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
        filters.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
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
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list tasks',
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

      if (!title || typeof title !== 'string') {
        return { success: false, error: 'title is required' };
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

      const sql = `
        INSERT INTO tasks (title, description, status, priority, category, due_date, assignees, tags, checklist, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7::UUID[], $8::TEXT[], $9::JSONB, $10)
        RETURNING id, title, description, status, priority, category, due_date, assignees, tags, checklist, created_by, created_at, updated_at
      `;
      const params = [
        title,
        description,
        status,
        priority,
        category,
        due_date,
        assigneeUUIDs,
        Array.isArray(tags) ? tags : [],
        checklist,
        created_by,
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


