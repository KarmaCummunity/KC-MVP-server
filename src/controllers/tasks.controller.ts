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
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const sql = `
      SELECT id, title, description, status, priority, due_date, assignees, tags, checklist, created_by, created_at, updated_at
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
      `SELECT id, title, description, status, priority, due_date, assignees, tags, checklist, created_by, created_at, updated_at
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
    const {
      title,
      description = null,
      status = 'open',
      priority = 'medium',
      due_date = null,
      assignees = [],
      tags = [],
      checklist = null,
      created_by = null,
    } = body || {};

    if (!title || typeof title !== 'string') {
      return { success: false, error: 'title is required' };
    }

    const sql = `
      INSERT INTO tasks (title, description, status, priority, due_date, assignees, tags, checklist, created_by)
      VALUES ($1, $2, $3, $4, $5, $6::UUID[], $7::TEXT[], $8::JSONB, $9)
      RETURNING id, title, description, status, priority, due_date, assignees, tags, checklist, created_by, created_at, updated_at
    `;
    const params = [
      title,
      description,
      status,
      priority,
      due_date,
      Array.isArray(assignees) ? assignees : [],
      Array.isArray(tags) ? tags : [],
      checklist,
      created_by,
    ];

    const { rows } = await this.pool.query(sql, params);
    return { success: true, data: rows[0] };
  }

  @Patch(':id')
  async updateTask(@Param('id') id: string, @Body() body: any) {
    // Build partial update dynamically
    const allowed = [
      'title',
      'description',
      'status',
      'priority',
      'due_date',
      'assignees',
      'tags',
      'checklist',
    ] as const;
    const sets: string[] = [];
    const params: any[] = [];

    for (const key of allowed) {
      if (key in body) {
        params.push(
          key === 'assignees'
            ? (Array.isArray(body[key]) ? body[key] : [])
            : key === 'tags'
            ? (Array.isArray(body[key]) ? body[key] : [])
            : body[key],
        );
        const idx = params.length;
        if (key === 'assignees') {
          sets.push(`assignees = $${idx}::UUID[]`);
        } else if (key === 'tags') {
          sets.push(`tags = $${idx}::TEXT[]`);
        } else if (key === 'checklist') {
          sets.push(`checklist = $${idx}::JSONB`);
        } else {
          sets.push(`${key} = $${idx}`);
        }
      }
    }

    if (!sets.length) {
      return { success: false, error: 'No valid fields to update' };
    }

    params.push(id);
    const sql = `
      UPDATE tasks SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING id, title, description, status, priority, due_date, assignees, tags, checklist, created_by, created_at, updated_at
    `;

    const { rows } = await this.pool.query(sql, params);
    if (!rows.length) {
      return { success: false, error: 'Task not found' };
    }
    return { success: true, data: rows[0] };
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


