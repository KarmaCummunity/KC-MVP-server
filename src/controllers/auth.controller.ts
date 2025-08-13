import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import * as argon2 from 'argon2';
import { OAuth2Client } from 'google-auth-library';
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
  private googleClient: OAuth2Client;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    this.googleClient = new OAuth2Client(clientId);
  }

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

  @Post('google')
  async googleAuth(@Body('idToken') idToken?: string, @Body('accessToken') accessToken?: string) {
    if (!idToken && !accessToken) {
      return { error: 'Missing Google token' };
    }

    try {
      let googleUser: any = null;

      // Verify ID token if provided
      if (idToken) {
        const ticket = await this.googleClient.verifyIdToken({
          idToken,
          audience: process.env.GOOGLE_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        
        if (!payload) {
          return { error: 'Invalid Google token' };
        }

        googleUser = {
          id: payload.sub,
          email: payload.email,
          name: payload.name || payload.given_name || 'Google User',
          avatar: payload.picture,
          emailVerified: payload.email_verified,
        };
      }
      // Alternatively, use access token to get user info
      else if (accessToken) {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        
        if (!response.ok) {
          return { error: 'Invalid Google access token' };
        }

        const profile = await response.json();
        googleUser = {
          id: profile.sub,
          email: profile.email,
          name: profile.name || profile.given_name || 'Google User',
          avatar: profile.picture,
          emailVerified: true, // Assume verified since it came from Google
        };
      }

      if (!googleUser || !googleUser.email) {
        return { error: 'Could not get user info from Google' };
      }

      const normalizedEmail = this.normalizeEmail(googleUser.email);
      const nowIso = new Date().toISOString();

      // Check if user exists
      const { rows } = await this.pool.query(
        `SELECT user_id, item_id, data FROM users WHERE lower(data->>'email') = $1 LIMIT 1`,
        [normalizedEmail],
      );

      let userData: any;
      let userId: string;

      if (rows.length > 0) {
        // Update existing user
        const existingData = rows[0].data || {};
        userData = {
          ...existingData,
          name: googleUser.name,
          avatar: googleUser.avatar,
          lastActive: nowIso,
          // Don't overwrite existing roles, settings, etc.
        };
        userId = rows[0].user_id;

        await this.pool.query(
          `UPDATE users SET data = $1::jsonb, updated_at = NOW() WHERE user_id = $2 AND item_id = $3`,
          [userData, userId, rows[0].item_id],
        );
      } else {
        // Create new user
        userId = normalizedEmail; // Use email as stable user ID
        userData = {
          id: userId,
          email: normalizedEmail,
          name: googleUser.name,
          phone: '+9720000000',
          avatar: googleUser.avatar || 'https://i.pravatar.cc/150?img=1',
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
          googleId: googleUser.id,
          emailVerified: googleUser.emailVerified,
        };

        await this.pool.query(
          `INSERT INTO users (user_id, item_id, data, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, NOW(), NOW())
           ON CONFLICT (user_id, item_id)
           DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [userId, userId, userData],
        );
      }

      return { ok: true, user: this.toPublicUser(userData) };
    } catch (error) {
      console.error('Google auth error:', error);
      return { error: 'Google authentication failed' };
    }
  }
}


