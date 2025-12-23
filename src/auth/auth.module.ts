// File overview:
// - Purpose: Auth-related providers bundle (session + rate-limit + JWT) and their Redis-backed storage.
// - Reached from: Imported by `AppModule`.
// - Provides: `SessionService`, `RateLimitService`, `JwtService`, auth guards; exports all for controllers.
import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { RateLimitService } from './rate-limit.service';
import { JwtService } from './jwt.service';
import { JwtAuthGuard, AdminAuthGuard, OptionalAuthGuard } from './jwt-auth.guard';
import { RedisCacheModule } from '../redis/redis-cache.module';

@Module({
  imports: [RedisCacheModule],
  providers: [SessionService, RateLimitService, JwtService, JwtAuthGuard, AdminAuthGuard, OptionalAuthGuard],
  exports: [SessionService, RateLimitService, JwtService, JwtAuthGuard, AdminAuthGuard, OptionalAuthGuard],
})
export class AuthModule {}
