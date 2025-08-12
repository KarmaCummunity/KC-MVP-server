import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import * as argon2 from 'argon2';
import { PG_POOL } from '../database/database.module';

type PublicUser = {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  roles?: string[];
  settings?: Record<string, unknown>;
  createdAt?: string;
  lastActive?: string;
};

@Controller('auth')
export class AuthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private normalizeEmail(email: string): string {
    return String(email || '').trim().toLowerCase();
  }

  private toPublicUser(rowData: any): PublicUser {
    const data = rowData || {};
    const { passwordHash, ...rest } = data;
    return rest as PublicUser;
  }

  @Get('check-email')
  async checkEmail(@Query('email') email?: string) {
    const normalized = this.normalizeEmail(email || '');
    if (!normalized) {
      return { exists: false };
    }
    const { rows } = await this.pool.query(
      `SELECT 1 FROM users WHERE lower(data->>'email') = $1 LIMIT 1`,
      [normalized],
    );
    return { exists: rows.length > 0 };
  }

  @Post('register')
  async register(@Body('email') email?: string, @Body('password') password?: string, @Body('name') name?: string) {
    const normalized = this.normalizeEmail(email || '');
    if (!normalized || !password) {
      return { error: 'Missing email or password' };
    }

    // Check if exists
    const existRes = await this.pool.query(
      `SELECT data FROM users WHERE lower(data->>'email') = $1 LIMIT 1`,
      [normalized],
    );
    if (existRes.rows.length > 0) {
      return { error: 'Email already registered' };
    }

    const passwordHash = await argon2.hash(password);
    const userId = normalized; // Use email as stable user id for MVP
    const nowIso = new Date().toISOString();
    const userData = {
      id: userId,
      email: normalized,
      name: name || normalized.split('@')[0],
      phone: '+9720000000',
      avatar: 'https://i.pravatar.cc/150?img=1',
      bio: 'משתמש חדש בקארמה קומיוניטי',
      karmaPoints: 0,
      joinDate: nowIso,
      isActive: true,
      lastActive: nowIso,
      location: { city: 'ישראל', country: 'IL' },
      interests: [],
      roles: ['user'],
      postsCount: 0,
      followersCount: 0,
      followingCount: 0,
      notifications: [
        { type: 'system', text: 'ברוך הבא!', date: nowIso },
      ],
      settings: { language: 'he', darkMode: false, notificationsEnabled: true },
      passwordHash,
    };

    await this.pool.query(
      `INSERT INTO users (user_id, item_id, data, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (user_id, item_id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [userId, userId, userData],
    );

    return { ok: true, user: this.toPublicUser(userData) };
  }

  @Post('login')
  async login(@Body('email') email?: string, @Body('password') password?: string) {
    const normalized = this.normalizeEmail(email || '');
    if (!normalized || !password) {
      return { error: 'Missing email or password' };
    }

    const { rows } = await this.pool.query(
      `SELECT user_id, item_id, data FROM users WHERE lower(data->>'email') = $1 LIMIT 1`,
      [normalized],
    );
    if (rows.length === 0) {
      return { error: 'Invalid email or password' };
    }
    const data = rows[0].data || {};
    const hash = data.passwordHash as string | undefined;
    if (!hash) {
      return { error: 'User cannot login with password' };
    }
    const valid = await argon2.verify(hash, password);
    if (!valid) {
      return { error: 'Invalid email or password' };
    }

    // Update lastActive
    const updated = { ...data, lastActive: new Date().toISOString() };
    await this.pool.query(
      `UPDATE users SET data = $1::jsonb, updated_at = NOW() WHERE user_id = $2 AND item_id = $3`,
      [updated, rows[0].user_id, rows[0].item_id],
    );

    return { ok: true, user: this.toPublicUser(updated) };
  }
}


