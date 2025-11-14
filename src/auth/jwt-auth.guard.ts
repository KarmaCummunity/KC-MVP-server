// File overview:
// - Purpose: JWT authentication guard to protect API endpoints
// - Provides: Token extraction, validation, user context injection
// - Security: Validates JWT tokens, handles expired/invalid tokens, rate limiting integration

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { Request } from 'express';
import { JwtService, SessionTokenPayload } from './jwt.service';
import { RateLimitService } from './rate-limit.service';

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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse();
    
    try {
      // Extract token from request
      const token = this.extractTokenFromHeader(request);
      if (!token) {
        this.logger.warn('Authentication failed: No token provided', {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          path: request.path,
          method: request.method
        });
        throw new UnauthorizedException('Authentication token is required');
      }

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

      // Verify token
      const payload = await this.jwtService.verifyToken(token);
      
      // Ensure it's an access token
      if (payload.type !== 'access') {
        throw new UnauthorizedException('Invalid token type');
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

    const isAdmin = user.roles.includes('admin') || user.roles.includes('org_admin');
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

  constructor(private readonly jwtService: JwtService) {}

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
