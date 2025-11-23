// File overview:
// - Purpose: CRUD עבור משימות קבוצתיות למנהל האפליקציה
// - Routes: /api/tasks (GET, POST), /api/tasks/:id (GET, PATCH, DELETE)
// - Storage: PostgreSQL טבלת tasks (schema.sql)
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

type TaskStatus = 'open' | 'in_progress' | 'done' | 'archived';
type TaskPriority = 'low' | 'medium' | 'high';

@Controller('/api/tasks')
export class TasksController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async listTasks(
    @Query('status') status?: TaskStatus,
    @Query('priority') priority?: TaskPriority,
    @Query('category') category?: string,
    @Query('limit') limitParam?: string,
    @Query('offset') offsetParam?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(String(limitParam || '100'), 10) || 100, 1), 500);
    const offset = Math.max(parseInt(String(offsetParam || '0'), 10) || 0, 0);

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
    return { success: true, data: rows };
  }

  @Get(':id')
  async getTask(@Param('id') id: string) {
    const { rows } = await this.pool.query(
      `SELECT id, title, description, status, priority, category, due_date, assignees, tags, checklist, created_by, created_at, updated_at
       FROM tasks WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      return { success: false, error: 'Task not found' };
    }
    return { success: true, data: rows[0] };
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
    const { rowCount } = await this.pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    if (!rowCount) {
      return { success: false, error: 'Task not found' };
    }
    return { success: true, message: 'Task deleted' };
  }
}


