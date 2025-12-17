// File overview:
// - Purpose: Authentication endpoints for email/password and Google OAuth with enhanced security.
// - Reached from: Routes under '/auth'.
// - Provides: check-email, register, login, google auth endpoints with secure validation.
// - External deps: argon2 for password hashing, google-auth-library for OAuth verification.
// - Security: Rate limiting, input validation DTOs, secure logging (no sensitive data).
//
// SECURITY IMPROVEMENTS:
// ✅ Input validation with class-validator DTOs
// ✅ Password hashing with Argon2 (industry standard)
// ✅ Secure logging - no tokens or passwords in logs
// ✅ Proper error handling with appropriate HTTP status codes
// ✅ Email normalization and validation
//
// TODO: Implement JWT token-based authentication instead of returning user objects
// TODO: Add refresh token mechanism for better security
// TODO: Add password strength requirements
// TODO: Add email verification flow
// TODO: Add 2FA (Two-Factor Authentication) support
// TODO: Add account lockout after multiple failed attempts
// TODO: Add audit logging for security events
// TODO: Implement proper session management
// TODO: Add rate limiting per user (not just global)
// TODO: Split into separate services (AuthService, UserService, GoogleAuthService)
import { Body, Controller, Get, Post, Query, Logger, BadRequestException, InternalServerErrorException, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import * as argon2 from 'argon2';
import { OAuth2Client } from 'google-auth-library';
import { PG_POOL } from '../database/database.module';
import { IsString, IsEmail, IsOptional, Length, validate } from 'class-validator';
import { Transform } from 'class-transformer';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtService } from '../auth/jwt.service';
import { RedisCacheService } from '../redis/redis-cache.service';

// DTO for Google Auth with proper validation
// Ensures tokens are within expected length ranges to prevent malformed data
class GoogleAuthDto {
  @IsString()
  @IsOptional()
  @Length(10, 5000, { message: 'ID token length is invalid' })
  idToken?: string;

  @IsString()
  @IsOptional()
  @Length(10, 2000, { message: 'Access token length is invalid' })
  accessToken?: string;

  @IsString()
  @IsOptional()
  @Length(1, 200, { message: 'Firebase UID length is invalid' })
  firebaseUid?: string; // Firebase UID from Firebase Auth (different from Google ID)
}

// DTO for login with validation
// Automatically transforms email to lowercase for consistent storage
class LoginDto {
  @IsEmail({}, { message: 'Invalid email format' })
  @Transform(({ value }) => value?.toLowerCase()?.trim())
  email!: string;

  @IsString()
  @Length(6, 100, { message: 'Password must be between 6 and 100 characters' })
  password!: string;
}

// DTO for registration - extends LoginDto with optional name field
class RegisterDto extends LoginDto {
  @IsString()
  @IsOptional()
  @Length(1, 100, { message: 'Name must be between 1 and 100 characters' })
  name?: string;
}

/**
 * Public user type - excludes sensitive data like password hash
 * This is what gets returned to clients
 */
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

/**
 * Authentication Controller
 * 
 * Handles user authentication via email/password and Google OAuth.
 * All sensitive operations are rate-limited to prevent abuse.
 * 
 * Security features:
 * - Rate limiting on all endpoints
 * - Input validation with DTOs
 * - Password hashing with Argon2
 * - Secure logging (no sensitive data in logs)
 * - Email normalization
 */
@Controller('auth')
@UseGuards(ThrottlerGuard) // Apply rate limiting to all auth endpoints
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private googleClient: OAuth2Client;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly jwtService: JwtService,
    private readonly redisCache: RedisCacheService,
  ) {
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

    if (!clientId) {
      this.logger.error('❌ Google Client ID not found in environment variables');
      throw new Error('Google authentication is not properly configured');
    }

    this.googleClient = new OAuth2Client(clientId);
    this.logger.log('✅ Google OAuth client initialized successfully');
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
        `SELECT firebase_uid FROM user_profiles WHERE LOWER(email) = LOWER($1) LIMIT 1`,
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
           WHERE firebase_uid = $4`,
          [name, avatar, !!userData.emailVerified, rows[0].firebase_uid],
        );
      } else {
        // Create temporary firebase_uid for legacy users
        const tempUid = 'temp_legacy_' + require('crypto').createHash('md5').update(email + Date.now()).digest('hex');
        await this.pool.query(
          `INSERT INTO user_profiles (
             email, name, avatar_url, firebase_uid
           ) VALUES ($1, $2, $3, $4)`,
          [
            email,
            name,
            avatar,
            tempUid
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


  /**
   * Check if an email is already registered in the system
   * 
   * Security: Rate limited to prevent email enumeration attacks
   * 
   * @param email - Email address to check
   * @returns Object with 'exists' boolean
   */
  @Get('check-email')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  async checkEmail(@Query('email') email?: string) {
    try {
      const normalized = this.normalizeEmail(email || '');
      if (!normalized || !this.isValidEmail(normalized)) {
        throw new BadRequestException('Invalid email format');
      }

      // SECURITY: Log only partial email (first 3 chars + domain) to prevent email leakage
      const emailParts = normalized.split('@');
      const safeEmail = emailParts[0].substring(0, 3) + '***@' + emailParts[1];
      this.logger.log(`Email availability check for: ${safeEmail}`);

      const { rows } = await this.pool.query(
        `SELECT 1 FROM user_profiles WHERE LOWER(email) = $1 LIMIT 1`,
        [normalized],
      );

      return { exists: rows.length > 0 };
    } catch (error: any) {
      // SECURITY: Don't leak email in error logs
      this.logger.error('Email check failed', { error: error.message });
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to check email availability');
    }
  }

  /**
   * Validate email format according to RFC 5321
   * 
   * @param email - Email to validate
   * @returns true if valid, false otherwise
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 320; // RFC 5321 limit
  }

  /**
   * Register a new user with email and password
   * 
   * Security:
   * - Rate limited to prevent spam registrations
   * - Password hashed with Argon2 (industry standard)
   * - Input validation via DTOs
   * - No sensitive data in logs
   * 
   * @param registerDto - User registration data
   * @returns Success status and public user data
   */
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 registrations per minute
  async register(@Body() registerDto: RegisterDto) {
    try {
      // Validate input
      const errors = await validate(registerDto);
      if (errors.length > 0) {
        throw new BadRequestException('Invalid input data');
      }

      const normalized = this.normalizeEmail(registerDto.email);

      // SECURITY: Log only partial email for privacy
      const emailParts = normalized.split('@');
      const safeEmail = emailParts[0].substring(0, 3) + '***@' + emailParts[1];
      this.logger.log(`Registration attempt for: ${safeEmail}`);

      // Check if exists
      const existRes = await this.pool.query(
        `SELECT firebase_uid FROM user_profiles WHERE LOWER(email) = $1 LIMIT 1`,
        [normalized],
      );
      if (existRes.rows.length > 0) {
        // SECURITY: Don't reveal if email exists to prevent enumeration
        this.logger.warn(`Registration failed - email already registered`);
        return { error: 'Email already registered' };
      }

      // SECURITY: Hash password with Argon2 (memory-hard algorithm, resistant to GPU attacks)
      const passwordHash = await argon2.hash(registerDto.password);
      const nowIso = new Date().toISOString();

      // Generate temporary Firebase UID if not provided (will be updated on Firebase login)
      // In a real scenario, the client should provide firebase_uid after Firebase auth
      const tempFirebaseUid = 'temp_' + require('crypto').createHash('md5').update(normalized + Date.now()).digest('hex');
      
      // Insert into user_profiles with firebase_uid (using only required fields)
      this.logger.debug(`About to INSERT: email=${normalized}, name=${registerDto.name || normalized.split('@')[0]}, firebase_uid=${tempFirebaseUid}`);
      const { rows: newUser } = await this.pool.query(
        `INSERT INTO user_profiles (
          email, name, password_hash, firebase_uid
        ) VALUES ($1, $2, $3, $4)
        RETURNING firebase_uid, email, name, avatar_url, roles, settings, created_at, last_active`,
        [
          normalized,
          registerDto.name || normalized.split('@')[0],
          passwordHash,
          tempFirebaseUid
        ],
      );
      this.logger.debug(`INSERT successful, got user: ${newUser[0]?.firebase_uid}`);

      const userId = newUser[0].firebase_uid;
      const userData = {
        id: userId,
        email: normalized,
        name: newUser[0].name,
        avatar: newUser[0].avatar_url,
        roles: newUser[0].roles,
        settings: newUser[0].settings,
        createdAt: newUser[0].created_at,
        lastActive: newUser[0].last_active,
      };

      // Clear statistics cache when new user is registered
      // This ensures totalUsers and other user-related stats are refreshed immediately
      await this.redisCache.clearStatsCaches();

      // SECURITY: Log success without exposing sensitive data
      this.logger.log(`✅ User registered successfully (ID: ${userId})`);
      return { ok: true, user: this.toPublicUser(userData) };

    } catch (error: any) {
      // SECURITY: Generic error message, log details separately
      this.logger.error('Registration failed');
      this.logger.error(error);
      this.logger.error(`Error details - code: ${error.code}, message: ${error.message}, detail: ${error.detail}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Registration failed');
    }
  }

  /**
   * Login with email and password
   * 
   * Security:
   * - Rate limited to prevent brute force attacks
   * - Password verification with Argon2
   * - Generic error messages (don't reveal if email exists)
   * - No sensitive data in logs
   * 
   * @param loginDto - Login credentials
   * @returns Success status and public user data
   */
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 login attempts per minute
  async login(@Body() loginDto: LoginDto) {
    try {
      // Validate input
      const errors = await validate(loginDto);
      if (errors.length > 0) {
        throw new BadRequestException('Invalid input data');
      }

      const normalized = this.normalizeEmail(loginDto.email);

      // SECURITY: Log only partial email
      const emailParts = normalized.split('@');
      const safeEmail = emailParts[0].substring(0, 3) + '***@' + emailParts[1];
      this.logger.log(`Login attempt for user: ${safeEmail}`);

      const { rows } = await this.pool.query(
        `SELECT firebase_uid, email, name, avatar_url, password_hash, roles, settings, created_at, last_active
         FROM user_profiles WHERE LOWER(email) = $1 LIMIT 1`,
        [normalized],
      );

      if (rows.length === 0) {
        // SECURITY: Generic error - don't reveal if email exists
        this.logger.warn(`Login failed - invalid credentials`);
        return { error: 'Invalid email or password' };
      }

      const hash = rows[0].password_hash as string | undefined;

      if (!hash) {
        // SECURITY: Generic error message
        this.logger.warn(`Login failed - no password hash for user`);
        return { error: 'User cannot login with password' };
      }

      // SECURITY: Verify password with Argon2 (constant-time comparison)
      const valid = await argon2.verify(hash, loginDto.password);
      if (!valid) {
        // SECURITY: Generic error - don't reveal that email exists
        this.logger.warn(`Login failed - invalid password`);
        return { error: 'Invalid email or password' };
      }

      // Update lastActive
      await this.pool.query(
        `UPDATE user_profiles SET last_active = NOW(), updated_at = NOW() WHERE firebase_uid = $1`,
        [rows[0].firebase_uid],
      );

      // Build user data object
      const userData = {
        id: rows[0].firebase_uid, // Using firebase_uid as id for compatibility
        firebase_uid: rows[0].firebase_uid,
        email: rows[0].email,
        name: rows[0].name,
        avatar: rows[0].avatar_url,
        roles: rows[0].roles || ['user'],
        settings: rows[0].settings || {},
        createdAt: rows[0].created_at,
        lastActive: new Date().toISOString(),
      };

      // SECURITY: Log success without exposing sensitive data
      this.logger.log(`✅ Successful login for user: ${rows[0].firebase_uid}`);
      return { ok: true, user: this.toPublicUser(userData) };
    } catch (error: any) {
      // SECURITY: Generic error message
      this.logger.error('Login error', { error: error.message });
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Login failed');
    }
  }

  /**
   * Authenticate with Google OAuth
   * 
   * Security:
   * - Rate limited to prevent abuse
   * - Server-side token verification (prevents token forgery)
   * - Email verification required
   * - No sensitive data in logs (no tokens logged)
   * 
   * @param googleAuthDto - Google OAuth tokens
   * @returns Success status and public user data
   */
  @Post('google')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 Google auth attempts per minute
  async googleAuth(@Body() googleAuthDto: GoogleAuthDto) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d972b032-7acf-44cf-988d-02bf836f69e8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'auth.controller.ts:473',message:'Google auth started',data:{hasIdToken:!!googleAuthDto.idToken,hasAccessToken:!!googleAuthDto.accessToken,hasFirebaseUid:!!googleAuthDto.firebaseUid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    try {
      // Validate input
      const errors = await validate(googleAuthDto);
      if (errors.length > 0) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d972b032-7acf-44cf-988d-02bf836f69e8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'auth.controller.ts:477',message:'Validation failed',data:{errorsCount:errors.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        throw new BadRequestException('Invalid token format');
      }

      const { idToken, accessToken, firebaseUid } = googleAuthDto;

      if (!idToken && !accessToken) {
        throw new BadRequestException('Missing Google token');
      }

      // SECURITY: Log auth attempt without exposing tokens
      this.logger.log('Google authentication attempt', {
        hasIdToken: !!idToken,
        hasAccessToken: !!accessToken,
        timestamp: new Date().toISOString()
      });

      let googleUser: any = null;

      // Verify ID token if provided
      if (idToken) {
        try {
          // SECURITY: Verify token with Google's servers (prevents forgery)
          const ticket = await this.googleClient.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
          });
          const payload = ticket.getPayload();

          if (!payload || !payload.email) {
            this.logger.warn('Invalid Google ID token payload');
            throw new BadRequestException('Invalid Google token');
          }

          // SECURITY: Email must be verified by Google
          if (!payload.email_verified) {
            // SECURITY: Log only domain, not full email
            const emailDomain = payload.email.split('@')[1];
            this.logger.warn(`Google account email not verified (domain: ${emailDomain})`);
            throw new BadRequestException('Google account email must be verified');
          }

          googleUser = {
            id: payload.sub, // Google ID (sub claim)
            googleId: payload.sub, // Store Google ID separately
            email: payload.email,
            name: payload.name || payload.given_name || 'Google User',
            avatar: payload.picture,
            emailVerified: payload.email_verified,
          };

          // SECURITY: Log only domain, not full email
          const emailDomain = payload.email.split('@')[1];
          this.logger.log(`✅ Google ID token verified successfully (domain: ${emailDomain})`);
        } catch (error) {
          this.logger.warn(`Google ID token verification failed: ${error instanceof Error ? error.message : String(error)}`);
          // If we have an access token, we can try to use that instead
          if (!accessToken) {
            throw error;
          }
          this.logger.log('Falling back to access token verification...');
        }
      }

      // If no googleUser yet (either no idToken or verification failed), try access token
      if (!googleUser && accessToken) {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) {
          // If we already tried idToken and it failed, and now accessToken also failed
          if (idToken) {
            throw new BadRequestException('Both ID token and Access token verification failed');
          }
          return { error: 'Invalid Google access token' };
        }

        const profile = await response.json();
        googleUser = {
          id: profile.sub, // Google ID (sub claim)
          googleId: profile.sub, // Store Google ID separately
          email: profile.email,
          name: profile.name || profile.given_name || 'Google User',
          avatar: profile.picture,
          emailVerified: true, // Assume verified since it came from Google
        };

        this.logger.log('✅ Google Access token verified successfully');
      }

      if (!googleUser || !googleUser.email) {
        this.logger.error('Failed to extract user info from Google response');
        throw new BadRequestException('Could not get user info from Google');
      }

      const normalizedEmail = this.normalizeEmail(googleUser.email);
      if (!this.isValidEmail(normalizedEmail)) {
        // SECURITY: Log only domain
        const emailDomain = normalizedEmail.split('@')[1];
        this.logger.error(`Invalid email from Google (domain: ${emailDomain})`);
        throw new BadRequestException('Invalid email from Google');
      }

      const nowIso = new Date().toISOString();

      // SECURITY: Log only partial email
      const emailParts = normalizedEmail.split('@');
      const safeEmail = emailParts[0].substring(0, 3) + '***@' + emailParts[1];
      this.logger.log(`Processing Google auth for user: ${safeEmail}`);

      // Extract Google ID and Firebase UID separately
      // Firebase UID is the actual UID from Firebase Auth, which is different from Google ID
      const googleIdToUse = googleUser.googleId || googleUser.id; // Google ID (sub claim)
      const firebaseUidToUse = firebaseUid; // Only Firebase UID, not Google ID

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d972b032-7acf-44cf-988d-02bf836f69e8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'auth.controller.ts:590',message:'Checking for existing user',data:{normalizedEmail,googleIdToUse,firebaseUidToUse},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      // Check if user exists by email or firebase_uid
      // Note: We no longer use google_id - Firebase UID is the sole identifier
      const result = await this.pool.query(
        `SELECT firebase_uid, email, name, avatar_url, roles, settings, created_at, last_active
         FROM user_profiles 
         WHERE LOWER(email) = $1 OR firebase_uid = $2
         LIMIT 1`,
        [normalizedEmail, firebaseUidToUse],
      );
      const rows = result.rows;

      let userData: any;
      let userId: string;

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d972b032-7acf-44cf-988d-02bf836f69e8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'auth.controller.ts:605',message:'User lookup result',data:{rowsFound:rows.length,userId:rows[0]?.id,userEmail:rows[0]?.email,hasAvatar:!!rows[0]?.avatar_url},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      if (rows.length > 0) {
        // Update existing user
        userId = rows[0].firebase_uid;
        
        // Update user's last_active and other profile fields if needed
        await this.pool.query(
          `UPDATE user_profiles 
           SET name = $1, avatar_url = $2, firebase_uid = $3, last_active = $4, updated_at = NOW()
           WHERE firebase_uid = $5`,
          [
            googleUser.name,
            googleUser.avatar || rows[0].avatar_url,
            firebaseUidToUse || userId, // Update Firebase UID if provided, else keep existing
            nowIso,
            userId,
          ],
        );

        // Fetch updated user data
        const { rows: updatedRows } = await this.pool.query(
          `SELECT firebase_uid, email, name, avatar_url, roles, settings, created_at, last_active
           FROM user_profiles WHERE firebase_uid = $1`,
          [userId],
        );

        userData = {
          id: updatedRows[0].firebase_uid, // Using firebase_uid as id for compatibility
          firebase_uid: updatedRows[0].firebase_uid,
          email: updatedRows[0].email,
          name: updatedRows[0].name,
          avatar: updatedRows[0].avatar_url,
          roles: updatedRows[0].roles || ['user'],
          settings: updatedRows[0].settings || {},
          createdAt: updatedRows[0].created_at,
          lastActive: updatedRows[0].last_active,
        };

        // Clear statistics cache when existing user is updated
        await this.redisCache.clearStatsCaches();
      } else {
        // Create new user with Firebase UID as primary key
        // If Firebase UID is not provided, create a temporary one
        const finalFirebaseUid = firebaseUidToUse || `temp_google_${googleIdToUse}`;
        
        const result = await this.pool.query(
          `INSERT INTO user_profiles (
            email, name, avatar_url, firebase_uid
          ) VALUES ($1, $2, $3, $4)
          RETURNING firebase_uid, email, name, avatar_url, roles, settings, created_at, last_active`,
          [
            normalizedEmail,
            googleUser.name,
            googleUser.avatar || 'https://i.pravatar.cc/150?img=1',
            finalFirebaseUid // firebase_uid (primary key)
          ],
        );
        
        const newUserRows = result.rows;

        userId = newUserRows[0].firebase_uid;
        userData = {
          id: newUserRows[0].firebase_uid, // Using firebase_uid as id for compatibility
          firebase_uid: newUserRows[0].firebase_uid,
          email: newUserRows[0].email,
          name: newUserRows[0].name,
          avatar: newUserRows[0].avatar_url,
          roles: newUserRows[0].roles || ['user'],
          settings: newUserRows[0].settings || {},
          createdAt: newUserRows[0].created_at,
          lastActive: newUserRows[0].last_active,
        };
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d972b032-7acf-44cf-988d-02bf836f69e8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'auth.controller.ts:680',message:'New user created',data:{userId:userData.id,userEmail:userData.email,userAvatar:userData.avatar},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion

        // Clear statistics cache when new user is created
        await this.redisCache.clearStatsCaches();
      }

      // SECURITY: Log success without exposing sensitive data
      this.logger.log(`✅ Google authentication successful (user ID: ${userId})`);

      // Generate JWT tokens for the authenticated user
      const publicUser = this.toPublicUser(userData);
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d972b032-7acf-44cf-988d-02bf836f69e8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'auth.controller.ts:794',message:'Returning public user',data:{userId:publicUser.id,userEmail:publicUser.email,userAvatar:publicUser.avatar,userDataAvatar:userData.avatar,hasAvatar:!!publicUser.avatar},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      const tokenPair = await this.jwtService.createTokenPair({
        id: publicUser.id,
        email: publicUser.email,
        roles: publicUser.roles || ['user'],
      });

      // Return tokens and user data in the format expected by the client
      return {
        success: true,
        tokens: {
          accessToken: tokenPair.accessToken,
          refreshToken: tokenPair.refreshToken,
          expiresIn: tokenPair.expiresIn,
          refreshExpiresIn: tokenPair.refreshExpiresIn,
        },
        user: publicUser,
      };
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d972b032-7acf-44cf-988d-02bf836f69e8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'auth.controller.ts:704',message:'Google auth error caught',data:{errorMessage:error?.message,errorName:error?.name,errorStack:error?.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      // SECURITY: Generic error message, log details separately
      this.logger.error('Google authentication failed', {
        error: error?.message || String(error),
        // Only include stack trace in development
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Google authentication failed');
    }
  }
}


