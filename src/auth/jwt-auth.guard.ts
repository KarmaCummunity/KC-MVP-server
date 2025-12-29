// File overview:
// - Purpose: JWT authentication guard to protect API endpoints
// - Provides: Token extraction, validation, user context injection
// - Security: Validates JWT tokens, handles expired/invalid tokens, rate limiting integration

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger, Inject } from '@nestjs/common';
import { Request } from 'express';
import { JwtService, SessionTokenPayload } from './jwt.service';
import { RateLimitService } from './rate-limit.service';
import { FirebaseAdminService } from './firebase-admin.service';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

// Extend Express Request to include user data
declare global {
  namespace Express {
    interface Request {
      user?: SessionTokenPayload;
    }
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  protected readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly rateLimitService: RateLimitService,
    private readonly firebaseAdmin: FirebaseAdminService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse();

    // DEVELOPMENT BYPASS: Allow requests without authentication in local development
    const isDevelopment = process.env.NODE_ENV === 'development' || process.env.ENVIRONMENT === 'development';
    const bypassAuth = process.env.BYPASS_AUTH === 'true';
    const railwayEnv = process.env.RAILWAY_ENVIRONMENT;

    this.logger.debug('🔐 Authentication check', {
      path: request.path,
      method: request.method,
      nodeEnv: process.env.NODE_ENV,
      environment: process.env.ENVIRONMENT,
      railwayEnv,
      isDevelopment,
      bypassAuth,
      hasAuthHeader: !!request.headers.authorization
    });

    if (isDevelopment || bypassAuth) {
      this.logger.debug('🔓 Development mode: Bypassing authentication', {
        path: request.path,
        method: request.method,
        isDevelopment,
        bypassAuth,
        railwayEnv
      });

      // In development, try to get the super admin from the database
      try {
        const { rows } = await this.pool.query(
          `SELECT id, email, roles FROM user_profiles WHERE email = 'navesarussi@gmail.com' LIMIT 1`
        );

        if (rows.length > 0) {
          const superAdmin = rows[0];
          request.user = {
            userId: superAdmin.id,
            email: superAdmin.email,
            roles: superAdmin.roles || ['user', 'admin', 'super_admin'],
            type: 'access',
            sessionId: 'dev-session-id',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 86400 // 24 hours from now
          };

          this.logger.debug('🔓 Using super admin from database', {
            userId: superAdmin.id,
            email: superAdmin.email,
            roles: superAdmin.roles
          });

          return true;
        }
      } catch (dbError) {
        this.logger.warn('Failed to fetch super admin from database, using fallback', dbError);
      }

      // Fallback: Create a generic mock admin user for development
      request.user = {
        userId: 'dev-user-id',
        email: 'navesarussi@gmail.com',
        roles: ['user', 'admin', 'super_admin'],
        type: 'access',
        sessionId: 'dev-session-id',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400 // 24 hours from now
      };

      return true;
    }

    try {
      // Extract token from request
      const token = this.extractTokenFromHeader(request);
      if (!token) {
        this.logger.warn('Authentication failed: No token provided', {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          path: request.path,
          method: request.method,
          environment: process.env.ENVIRONMENT,
          nodeEnv: process.env.NODE_ENV,
          railwayEnv: process.env.RAILWAY_ENVIRONMENT,
          authHeader: request.headers.authorization ? 'present' : 'missing',
          customAuthHeader: request.headers['x-auth-token'] ? 'present' : 'missing'
        });
        throw new UnauthorizedException('Authentication token is required');
      }

      this.logger.debug('Token extracted from request', {
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 20) + '...',
        path: request.path
      });

      // Apply rate limiting per user token
      const rateLimitResult = await this.rateLimitService.checkRateLimit(
        token.substring(0, 16), // Use token prefix as identifier
        'api_access',
        { requests: 100, windowMs: 60 * 1000, blockDurationMs: 5 * 60 * 1000 }
      );

      if (!rateLimitResult.allowed) {
        this.logger.warn('Rate limit exceeded for authenticated request', {
          ip: request.ip,
          path: request.path,
          rateLimitInfo: rateLimitResult
        });

        response.setHeader('X-RateLimit-Limit', '100');
        response.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
        response.setHeader('X-RateLimit-Reset', rateLimitResult.resetTime);

        throw new UnauthorizedException('Rate limit exceeded');
      }

      // Try to verify as JWT first, if fails try Firebase token
      let payload: SessionTokenPayload;
      try {
        payload = await this.jwtService.verifyToken(token);

        // Ensure it's an access token
        if (payload.type !== 'access') {
          throw new UnauthorizedException('Invalid token type');
        }
      } catch (jwtError) {
        // If JWT verification failed, try Firebase token
        this.logger.debug('JWT verification failed, trying Firebase token', {
          jwtError: jwtError instanceof Error ? jwtError.message : String(jwtError),
          path: request.path
        });
        payload = await this.verifyFirebaseToken(token);
      }

      // Attach user data to request
      request.user = payload;

      // Log successful authentication
      this.logger.debug('Authentication successful', {
        userId: payload.userId,
        email: payload.email,
        sessionId: payload.sessionId,
        path: request.path,
        method: request.method
      });

      // Add security headers
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader('X-XSS-Protection', '1; mode=block');

      return true;

    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error('Authentication guard error', {
        error: error instanceof Error ? error.message : String(error),
        ip: request.ip,
        path: request.path,
        method: request.method
      });

      throw new UnauthorizedException('Authentication failed');
    }
  }

  private async verifyFirebaseToken(token: string): Promise<SessionTokenPayload> {
    try {
      // Verify Firebase ID token
      const decodedToken = await this.firebaseAdmin.verifyIdToken(token);

      // Get user from database using firebase_uid
      const result = await this.pool.query(
        `SELECT id, email, roles FROM user_profiles WHERE firebase_uid = $1`,
        [decodedToken.uid]
      );

      if (result.rows.length === 0) {
        throw new UnauthorizedException('User not found in database');
      }

      const user = result.rows[0];

      // Create session payload compatible with JWT payload
      const payload: SessionTokenPayload = {
        userId: user.id,
        email: user.email || decodedToken.email,
        sessionId: `firebase_${decodedToken.uid}`,
        roles: user.roles || ['user'],
        iat: Math.floor(Date.now() / 1000),
        exp: decodedToken.exp,
        type: 'access',
      };

      this.logger.debug('Firebase token verified successfully', {
        userId: payload.userId,
        email: payload.email,
        firebaseUid: decodedToken.uid
      });

      return payload;
    } catch (error) {
      this.logger.warn('Firebase token verification failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new UnauthorizedException('Invalid Firebase token');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    // Try multiple common header formats
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Also check for custom header (for mobile apps)
    const customAuth = request.headers['x-auth-token'] as string;
    if (customAuth) {
      return customAuth;
    }

    return undefined;
  }
}

/**
 * Optional guard for admin-only endpoints
 */
@Injectable()
export class AdminAuthGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const canActivate = await super.canActivate(context);
    if (!canActivate) return false;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user!;

    const isAdmin = user.roles.includes('admin') ||
      user.roles.includes('org_admin') ||
      user.roles.includes('super_admin') ||
      user.email === 'navesarussi@gmail.com';
    if (!isAdmin) {
      this.logger.warn('Admin access denied', {
        userId: user.userId,
        email: user.email,
        roles: user.roles,
        path: request.path
      });
      throw new UnauthorizedException('Admin access required');
    }

    return true;
  }
}

/**
 * Optional guard that allows both authenticated and guest access
 * Sets user data if token is provided and valid
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalAuthGuard.name);

  constructor(private readonly jwtService: JwtService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    try {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const payload = await this.jwtService.verifyToken(token);

        if (payload.type === 'access') {
          request.user = payload;
          this.logger.debug('Optional auth: user authenticated', {
            userId: payload.userId,
            path: request.path
          });
        }
      }
    } catch (error) {
      // Ignore authentication errors for optional auth
      this.logger.debug('Optional auth: proceeding without authentication', {
        path: request.path,
        reason: error instanceof Error ? error.message : String(error)
      });
    }

    return true; // Always allow access
  }
}
