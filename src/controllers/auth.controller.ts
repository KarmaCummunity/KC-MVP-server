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
import { Body, Controller, Get, Post, Query, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import * as argon2 from 'argon2';
import { OAuth2Client } from 'google-auth-library';
import { PG_POOL } from '../database/database.module';
import { IsString, IsEmail, IsOptional, Length, validate } from 'class-validator';
import { Transform } from 'class-transformer';

// DTO for Google Auth with proper validation
class GoogleAuthDto {
  @IsString()
  @IsOptional()
  @Length(100, 5000, { message: 'ID token length is invalid' })
  idToken?: string;

  @IsString()
  @IsOptional() 
  @Length(50, 2000, { message: 'Access token length is invalid' })
  accessToken?: string;
}

// DTO for login with validation
class LoginDto {
  @IsEmail({}, { message: 'Invalid email format' })
  @Transform(({ value }) => value?.toLowerCase()?.trim())
  email!: string;

  @IsString()
  @Length(6, 100, { message: 'Password must be between 6 and 100 characters' })
  password!: string;
}

// DTO for registration
class RegisterDto extends LoginDto {
  @IsString()
  @IsOptional()
  @Length(1, 100, { message: 'Name must be between 1 and 100 characters' })
  name?: string;
}

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
  private readonly logger = new Logger(AuthController.name);
  private googleClient: OAuth2Client;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    
    if (!clientId) {
      this.logger.error('Google Client ID not found in environment variables');
      throw new Error('Google authentication is not properly configured');
    }
    
    this.googleClient = new OAuth2Client(clientId);
    this.logger.log('Google OAuth client initialized successfully');
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
    try {
      const normalized = this.normalizeEmail(email || '');
      if (!normalized || !this.isValidEmail(normalized)) {
        throw new BadRequestException('Invalid email format');
      }

      this.logger.log(`Email availability check for: ${normalized}`);
      
      const { rows } = await this.pool.query(
        `SELECT 1 FROM users WHERE lower(data->>'email') = $1 LIMIT 1`,
        [normalized],
      );
      
      return { exists: rows.length > 0 };
    } catch (error: any) {
      this.logger.error('Email check failed', { error: error.message, email: email?.substring(0, 5) + '...' });
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to check email availability');
    }
  }
  
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 320; // RFC 5321 limit
  }

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    try {
      // Validate input
      const errors = await validate(registerDto);
      if (errors.length > 0) {
        throw new BadRequestException('Invalid input data');
      }

      const normalized = this.normalizeEmail(registerDto.email);
      
      this.logger.log(`Registration attempt for: ${normalized}`);

      // Check if exists
      const existRes = await this.pool.query(
        `SELECT data FROM users WHERE lower(data->>'email') = $1 LIMIT 1`,
        [normalized],
      );
      if (existRes.rows.length > 0) {
        this.logger.warn(`Registration failed - email already exists: ${normalized}`);
        return { error: 'Email already registered' };
      }

      const passwordHash = await argon2.hash(registerDto.password);
      const userId = normalized; // Use email as stable user id for MVP
      const nowIso = new Date().toISOString();
      const userData = {
        id: userId,
        email: normalized,
        name: registerDto.name || normalized.split('@')[0],
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
      
      this.logger.log(`User registered successfully: ${normalized}`);
      return { ok: true, user: this.toPublicUser(userData) };
      
    } catch (error: any) {
      this.logger.error('Registration failed', { error: error.message });
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Registration failed');
    }
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    try {
      // Validate input
      const errors = await validate(loginDto);
      if (errors.length > 0) {
        throw new BadRequestException('Invalid input data');
      }

      const normalized = this.normalizeEmail(loginDto.email);
      
      this.logger.log(`Login attempt for user: ${normalized}`);

      const { rows } = await this.pool.query(
        `SELECT user_id, item_id, data FROM users WHERE lower(data->>'email') = $1 LIMIT 1`,
        [normalized],
      );
      
      if (rows.length === 0) {
        this.logger.warn(`Login failed - user not found: ${normalized}`);
        return { error: 'Invalid email or password' };
      }
      
      const data = rows[0].data || {};
      const hash = data.passwordHash as string | undefined;
      
      if (!hash) {
        this.logger.warn(`Login failed - no password hash for user: ${normalized}`);
        return { error: 'User cannot login with password' };
      }
      
      const valid = await argon2.verify(hash, loginDto.password);
      if (!valid) {
        this.logger.warn(`Login failed - invalid password for user: ${normalized}`);
        return { error: 'Invalid email or password' };
      }

      // Update lastActive
      const updated = { ...data, lastActive: new Date().toISOString() };
      await this.pool.query(
        `UPDATE users SET data = $1::jsonb, updated_at = NOW() WHERE user_id = $2 AND item_id = $3`,
        [updated, rows[0].user_id, rows[0].item_id],
      );

      this.logger.log(`Successful login for user: ${normalized}`);
      return { ok: true, user: this.toPublicUser(updated) };
    } catch (error: any) {
      this.logger.error('Login error', { error: error.message });
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Login failed');
    }
  }

  @Post('google')
  async googleAuth(@Body() googleAuthDto: GoogleAuthDto) {
    try {
      // Validate input
      const errors = await validate(googleAuthDto);
      if (errors.length > 0) {
        throw new BadRequestException('Invalid token format');
      }

      const { idToken, accessToken } = googleAuthDto;
      
      if (!idToken && !accessToken) {
        throw new BadRequestException('Missing Google token');
      }

      this.logger.log('Google authentication attempt', { 
        hasIdToken: !!idToken, 
        hasAccessToken: !!accessToken,
        timestamp: new Date().toISOString()
      });
      
      let googleUser: any = null;

      // Verify ID token if provided
      if (idToken) {
        const ticket = await this.googleClient.verifyIdToken({
          idToken,
          audience: process.env.GOOGLE_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        
        if (!payload || !payload.email) {
          this.logger.warn('Invalid Google ID token payload');
          throw new BadRequestException('Invalid Google token');
        }

        // Additional security checks
        if (!payload.email_verified) {
          this.logger.warn('Google account email not verified', { email: payload.email });
          throw new BadRequestException('Google account email must be verified');
        }

        googleUser = {
          id: payload.sub,
          email: payload.email,
          name: payload.name || payload.given_name || 'Google User',
          avatar: payload.picture,
          emailVerified: payload.email_verified,
        };
        
        this.logger.log('Google ID token verified successfully', { email: payload.email });
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
        this.logger.error('Failed to extract user info from Google response');
        throw new BadRequestException('Could not get user info from Google');
      }

      const normalizedEmail = this.normalizeEmail(googleUser.email);
      if (!this.isValidEmail(normalizedEmail)) {
        this.logger.error('Invalid email from Google', { email: normalizedEmail });
        throw new BadRequestException('Invalid email from Google');
      }
      
      const nowIso = new Date().toISOString();
      
      this.logger.log('Processing Google auth for user', { email: normalizedEmail });

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

      // Best-effort relational upsert (if user_profiles exists)
      await this.upsertUserProfileFromLegacy(userData);

      this.logger.log('Google authentication successful', { email: normalizedEmail });
      return { ok: true, user: this.toPublicUser(userData) };
    } catch (error: any) {
      this.logger.error('Google authentication failed', { 
        error: error?.message || String(error),
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
      });
      
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Google authentication failed');
    }
  }
}


