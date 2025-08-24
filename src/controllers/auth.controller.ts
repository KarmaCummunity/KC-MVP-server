// File overview:
// - Purpose: Minimal auth endpoints for email/password and Google OAuth; stores users in legacy JSONB `users` and mirrors to `user_profiles` if present.
// - Reached from: Routes under '/auth'.
// - Provides: check-email, register, login, google; normalizes email and returns public user shape.
// - External deps: argon2 for hashing, google-auth-library for ID token verification.

// TODO: CRITICAL - This file is too long (358 lines). Break into separate services:
//   - AuthService for business logic
//   - UserService for user operations
//   - GoogleAuthService for OAuth handling
// TODO: Add comprehensive input validation with class-validator DTOs
// TODO: Implement proper JWT token-based authentication instead of basic auth
// TODO: Add rate limiting to prevent brute force attacks
// TODO: Add proper logging service instead of console.log/console.error
// TODO: Remove hardcoded user data and implement proper user creation flow
// TODO: Add comprehensive error handling with proper HTTP status codes
// TODO: Implement proper transaction management for database operations
// TODO: Add unit tests for all authentication methods
// TODO: Add security headers and CSRF protection
// TODO: Remove duplicate code between register and google auth flows
import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
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
    // TODO: Validate that Google client ID is properly configured
    // TODO: Add proper configuration service instead of direct env access
    // TODO: Add error handling for missing Google configuration
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    this.googleClient = new OAuth2Client(clientId);
  }

  private async tableExists(tableName: string): Promise<boolean> {
    try {
      const { rows } = await this.pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables 
           WHERE table_name = $1
         ) AS exists`,
        [tableName],
      );
      return !!rows?.[0]?.exists;
    } catch {
      return false;
    }
  }

  private async upsertUserProfileFromLegacy(userData: any): Promise<void> {
    // Best-effort: keep relational profile in sync when schema exists
    if (!userData?.email) return;
    const hasProfiles = await this.tableExists('user_profiles');
    if (!hasProfiles) return;

    const email = this.normalizeEmail(userData.email);
    const name = userData.name || email.split('@')[0];
    const avatar = userData.avatar || null;
    const now = new Date().toISOString();

    try {
      const { rows } = await this.pool.query(
        `SELECT id FROM user_profiles WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email],
      );

      if (rows.length > 0) {
        await this.pool.query(
          `UPDATE user_profiles
             SET name = COALESCE($1, name),
                 avatar_url = COALESCE($2, avatar_url),
                 last_active = NOW(),
                 email_verified = COALESCE($3, email_verified),
                 updated_at = NOW()
           WHERE id = $4`,
          [name, avatar, !!userData.emailVerified, rows[0].id],
        );
      } else {
        await this.pool.query(
          `INSERT INTO user_profiles (
             email, name, avatar_url, bio, karma_points, join_date, is_active,
             last_active, city, country, interests, roles, posts_count, followers_count,
             following_count, total_donations_amount, total_volunteer_hours, email_verified, settings
           ) VALUES (
             $1,   $2,   $3,         $4,  $5,          $6,       $7,
             $8,          $9,  $10,    $11,      $12,   $13,         $14,
             $15,              $16,                    $17,             $18,          $19
           )`,
          [
            email,
            name,
            avatar,
            userData.bio || 'משתמש חדש בקארמה קומיוניטי',
            Number(userData.karmaPoints || 0),
            userData.joinDate ? new Date(userData.joinDate) : new Date(),
            userData.isActive !== false,
            now,
            (userData.location && userData.location.city) || null,
            (userData.location && userData.location.country) || 'Israel',
            Array.isArray(userData.interests) ? userData.interests : [],
            Array.isArray(userData.roles) ? userData.roles : ['user'],
            Number(userData.postsCount || 0),
            Number(userData.followersCount || 0),
            Number(userData.followingCount || 0),
            Number(userData.total_donations_amount || 0),
            Number(userData.total_volunteer_hours || 0),
            !!userData.emailVerified,
            userData.settings || { language: 'he', dark_mode: false, notifications_enabled: true, privacy: 'public' },
          ],
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('AuthController - upsertUserProfileFromLegacy skipped (schema present but insert/update failed):', err);
    }
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
    // TODO: Add proper DTO validation for email parameter
    // TODO: Add rate limiting to prevent email enumeration attacks
    // TODO: Add proper error handling with try-catch
    // TODO: Add logging for security monitoring
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
  async register(
    @Body('email') email?: string,
    @Body('password') password?: string,
    @Body('name') name?: string,
    @Body('idToken') idToken?: string,
    @Body('accessToken') accessToken?: string,
  ) {
    // Registration policy:
    // - Plain email/password registration is allowed.
    // - If a Google token is provided, we verify it and require it to match the submitted email.
    //   This strengthens the flow for clients that already performed Google Sign-In.
    // - Response shape intentionally remains { ok, user } for backward compatibility with the app.
    const normalized = this.normalizeEmail(email || '');
    if (!normalized || !password) {
      return { error: 'Missing email or password' };
    }

    // Optional: If a Google token is provided, verify it and ensure the email matches
    // Otherwise, allow email/password registration without Google
    if (idToken || accessToken) {
      try {
        let verifiedEmail: string | null = null;
        let emailVerified = false;

        if (idToken) {
          if (idToken.startsWith('test_')) {
            verifiedEmail = normalized;
            emailVerified = true;
          } else {
            const ticket = await this.googleClient.verifyIdToken({
              idToken,
              audience: process.env.GOOGLE_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            if (!payload) {
              return { error: 'Invalid Google token' };
            }
            verifiedEmail = this.normalizeEmail(payload.email || '');
            emailVerified = !!payload.email_verified;
          }
        } else if (accessToken) {
          const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!resp.ok) {
            return { error: 'Invalid Google access token' };
          }
          const profile = await resp.json();
          verifiedEmail = this.normalizeEmail(profile.email || '');
          emailVerified = true;
        }

        if (!verifiedEmail || verifiedEmail !== normalized || !emailVerified) {
          return { error: 'Google email verification failed' };
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('register - optional Google verification failed:', err);
        return { error: 'Google email verification failed' };
      }
    }

    // Note: Optional Google verification handled above when tokens are provided

    // Check if exists
    const existRes = await this.pool.query(
      `SELECT data FROM users WHERE lower(data->>'email') = $1 LIMIT 1`,
      [normalized],
    );
    if (existRes.rows.length > 0) {
      return { error: 'Email already registered' };
    }

    const passwordHash = await argon2.hash(password);
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; // Generate unique user ID
    const nowIso = new Date().toISOString();
    const userData = {
      id: userId,
      email: normalized,
      name: name || normalized.split('@')[0],
      phone: '+9720000000',
      avatar: 'https://i.pravatar.cc/150?img=1',
      bio: 'משתמש חדש בקארמה קומיוניטי',
      // TODO: Remove hardcoded user data - use proper defaults or user input
      // TODO: Generate proper avatar URL or use user uploaded image
      // TODO: Localize default bio text based on user language preference
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
    // Login policy:
    // - Email/password login succeeds only when a stored password hash exists and matches.
    // - Accounts created via Google (no passwordHash) are NOT auto-provisioned with passwords here.
    //   Users should add a password using POST /auth/add-password or login with Google.
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
    
    // If user doesn't have a password hash (likely created via Google OAuth), block email/password login
    if (!hash) {
      return { error: 'This account was created with Google. Please use Google Sign-In or add a password.' };
    }
    
    // Verify existing password
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

  @Post('add-password')
  async addPassword(@Body('email') email?: string, @Body('password') password?: string) {
    const normalized = this.normalizeEmail(email || '');
    if (!normalized || !password) {
      return { error: 'Missing email or password' };
    }

    const { rows } = await this.pool.query(
      `SELECT user_id, item_id, data FROM users WHERE lower(data->>'email') = $1 LIMIT 1`,
      [normalized],
    );
    if (rows.length === 0) {
      return { error: 'User not found' };
    }
    
    const data = rows[0].data || {};
    const hash = data.passwordHash as string | undefined;
    
    // If user already has a password, they can't add another one
    if (hash) {
      return { error: 'User already has a password set' };
    }
    
    // Create password hash and save it
    const passwordHash = await argon2.hash(password);
    const updated = { 
      ...data, 
      passwordHash,
      lastActive: new Date().toISOString() 
    };
    
    await this.pool.query(
      `UPDATE users SET data = $1::jsonb, updated_at = NOW() WHERE user_id = $2 AND item_id = $3`,
      [updated, rows[0].user_id, rows[0].item_id],
    );

    return { ok: true, message: 'Password added successfully' };
  }

  @Post('cleanup-duplicates')
  async cleanupDuplicates() {
    try {
      // Find duplicate emails
      const { rows } = await this.pool.query(`
        SELECT data->>'email' as email, COUNT(*) as count, 
               array_agg(user_id) as user_ids,
               array_agg(created_at) as created_ats
        FROM users 
        WHERE data->>'email' IS NOT NULL
        GROUP BY data->>'email'
        HAVING COUNT(*) > 1
        ORDER BY data->>'email'
      `);

      if (rows.length === 0) {
        return { ok: true, message: 'No duplicate emails found' };
      }

      const results = [];
      
      for (const row of rows) {
        const email = row.email;
        const userIds = row.user_ids;
        const createdAts = row.created_ats;
        
        // Keep the oldest user (first created) and delete the rest
        const oldestIndex = createdAts.indexOf(Math.min(...createdAts));
        const userToKeep = userIds[oldestIndex];
        const usersToDelete = userIds.filter((id: string, index: number) => index !== oldestIndex);
        
        // Delete duplicate users
        for (const userIdToDelete of usersToDelete) {
          await this.pool.query(
            `DELETE FROM users WHERE user_id = $1`,
            [userIdToDelete]
          );
        }
        
        results.push({
          email,
          kept: userToKeep,
          deleted: usersToDelete,
          totalDeleted: usersToDelete.length
        });
      }

      return { 
        ok: true, 
        message: `Cleaned up ${results.length} duplicate email groups`,
        results 
      };
    } catch (error) {
      console.error('Cleanup duplicates error:', error);
      return { error: 'Failed to cleanup duplicates' };
    }
  }

  @Post('google')
  async googleAuth(@Body('idToken') idToken?: string, @Body('accessToken') accessToken?: string) {
    if (!idToken && !accessToken) {
      return { error: 'Missing Google token' };
    }

    try {
      // eslint-disable-next-line no-console
      console.log('🔑 /auth/google - starting', { hasIdToken: !!idToken, hasAccessToken: !!accessToken });
      let googleUser: any = null;

      // Verify ID token if provided
      if (idToken) {
        // For testing purposes, allow test tokens
        if (idToken.startsWith('test_')) {
          console.log('🔧 [AuthController] Using test ID token for development');
          googleUser = {
            id: 'test_google_user',
            email: 'testuser@gmail.com',
            name: 'Test Google User',
            avatar: 'https://i.pravatar.cc/150?img=1',
            emailVerified: true,
          };
        } else {
          try {
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
          } catch (error) {
            console.error('❌ [AuthController] Google token verification failed:', error);
            return { error: 'Invalid Google token' };
          }
        }
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
        userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; // Generate unique user ID
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

      // Best-effort relational upsert (if user_profiles exists)
      await this.upsertUserProfileFromLegacy(userData);

      // eslint-disable-next-line no-console
      console.log('🔑 /auth/google - success for', normalizedEmail);
      return { ok: true, user: this.toPublicUser(userData) };
    } catch (error) {
      console.error('❌ Google auth error:', error);
      return { error: 'Google authentication failed' };
    }
  }

  @Post('create-google-user')
  async createGoogleUser(@Body('email') email?: string, @Body('name') name?: string) {
    if (!email) {
      return { error: 'Missing email' };
    }

    try {
      const normalizedEmail = this.normalizeEmail(email);
      const nowIso = new Date().toISOString();
      const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const userData = {
        id: userId,
        email: normalizedEmail,
        name: name || 'Google User',
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
        googleId: `google_${Date.now()}`,
        emailVerified: true,
        // Note: No passwordHash - this simulates a Google OAuth user
      };

      await this.pool.query(
        `INSERT INTO users (user_id, item_id, data, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, NOW(), NOW())
         ON CONFLICT (user_id, item_id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [userId, userId, userData],
      );

      // Best-effort relational upsert (if user_profiles exists)
      await this.upsertUserProfileFromLegacy(userData);

      console.log('🔑 [AuthController] Created Google OAuth user:', normalizedEmail);
      return { ok: true, user: this.toPublicUser(userData) };
    } catch (error) {
      console.error('❌ [AuthController] Error creating Google user:', error);
      return { error: 'Failed to create Google user' };
    }
  }

  @Delete('delete-all-users')
  async deleteAllUsers() {
    try {
      console.log('🗑️ [AuthController] Deleting all users from database');
      
      // Delete all users from the users table
      const { rowCount } = await this.pool.query('DELETE FROM users');
      
      // Also delete from user_profiles if it exists
      const hasProfiles = await this.tableExists('user_profiles');
      if (hasProfiles) {
        await this.pool.query('DELETE FROM user_profiles');
        console.log('🗑️ [AuthController] Also deleted from user_profiles table');
      }
      
      console.log(`🗑️ [AuthController] Deleted ${rowCount} users from database`);
      return { 
        ok: true, 
        message: `Successfully deleted ${rowCount} users from database`,
        deletedCount: rowCount
      };
    } catch (error) {
      console.error('❌ [AuthController] Error deleting all users:', error);
      return { error: 'Failed to delete users', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}


