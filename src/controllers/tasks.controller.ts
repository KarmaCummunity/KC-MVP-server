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
    @Query('assignee') assignee?: string, // UUID to filter tasks containing this user
    @Query('q') q?: string, // search in title/description
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
    if (assignee) {
      params.push(assignee);
      filters.push(`$${params.length} = ANY(assignees)`);
    }
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      filters.push(`(LOWER(title) LIKE $${params.length} OR LOWER(description) LIKE $${params.length})`);
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
    const {
      title,
      description = null,
      status = 'open',
      priority = 'medium',
      category = null,
      due_date = null,
      assignees = [],
      assigneesEmails = [], // optional: resolve emails to uuids
      tags = [],
      checklist = null,
      created_by = null,
    } = body || {};

    if (!title || typeof title !== 'string') {
      return { success: false, error: 'title is required' };
    }

    // Resolve assignees by email if provided
    const resolvedAssignees = await this.resolveAssignees(assignees, assigneesEmails);

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
      resolvedAssignees,
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
      'category',
      'due_date',
      'assignees',
      'assigneesEmails',
      'tags',
      'checklist',
    ] as const;
    const sets: string[] = [];
    const params: any[] = [];

    for (const key of allowed) {
      if (key in body) {
        if (key === 'assignees' || key === 'assigneesEmails') {
          // defer resolution after loop
          continue;
        }
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

    // Resolve assignees if provided by UUIDs/emails
    if ('assignees' in body || 'assigneesEmails' in body) {
      const resolved = await this.resolveAssignees(body.assignees, body.assigneesEmails);
      params.push(resolved);
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
  }

  @Delete(':id')
  async deleteTask(@Param('id') id: string) {
    const { rowCount } = await this.pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    if (!rowCount) {
      return { success: false, error: 'Task not found' };
    }
    return { success: true, message: 'Task deleted' };
  }

  private async resolveAssignees(assignees?: any, assigneesEmails?: any): Promise<string[]> {
    const uuids: string[] = Array.isArray(assignees) ? assignees.filter(Boolean) : [];
    const emails: string[] = Array.isArray(assigneesEmails) ? assigneesEmails.filter(Boolean) : [];
    if (!emails.length) return uuids;
    if (!emails.length) return uuids;
    const uniqueEmails = Array.from(new Set(emails.map((e) => String(e).toLowerCase().trim()).filter(Boolean)));
    if (!uniqueEmails.length) return uuids;
    const placeholders = uniqueEmails.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `SELECT id FROM user_profiles WHERE LOWER(email) IN (${placeholders})`;
    const { rows } = await this.pool.query(sql, uniqueEmails);
    const found = rows.map((r: any) => r.id).filter(Boolean);
    const merged = Array.from(new Set([...uuids, ...found]));
    return merged;
  }
}


