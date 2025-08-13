// File overview:
// - Purpose: Auth-related providers bundle (session + rate-limit) and their Redis-backed storage.
// - Reached from: Imported by `AppModule`.
// - Provides: `SessionService`, `RateLimitService`; exports both for controllers.
import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { RateLimitService } from './rate-limit.service';
import { RedisCacheModule } from '../redis/redis-cache.module';

@Module({
  imports: [RedisCacheModule],
  providers: [SessionService, RateLimitService],
  exports: [SessionService, RateLimitService],
})
export class AuthModule {}
