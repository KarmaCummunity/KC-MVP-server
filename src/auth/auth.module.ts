// File overview:
// - Purpose: Auth-related providers bundle (session + rate-limit + JWT) and their Redis-backed storage.
// - Reached from: Imported by `AppModule`.
// - Provides: `SessionService`, `RateLimitService`, `JwtService`; exports all for controllers.
import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { RateLimitService } from './rate-limit.service';
import { JwtService } from './jwt.service';
import { RedisCacheModule } from '../redis/redis-cache.module';

@Module({
  imports: [RedisCacheModule],
  providers: [SessionService, RateLimitService, JwtService],
  exports: [SessionService, RateLimitService, JwtService],
})
export class AuthModule {}
