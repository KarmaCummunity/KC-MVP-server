// File overview:
// - Purpose: Root Nest module wiring configuration, database, redis, auth, and feature controllers.
// - Reached from: `main.ts` NestFactory.create(AppModule).
// - Provides: Controllers for health, places (Google), chat, auth, session, rate-limit, donations, rides, users, stats.
// - Imports: ConfigModule (global), DatabaseModule (PG pool), RedisModule/RedisCacheModule, AuthModule, ItemsModule.
// - Providers: `DatabaseInit` runs schema/compat setup on startup.

// TODO: Add proper module organization - group related controllers into feature modules
// TODO: Add environment-specific configuration validation
// TODO: Add health check module with proper database/redis connectivity checks
// TODO: Implement proper module imports/exports structure
// TODO: Add API versioning support
// TODO: Add comprehensive logging module (Winston, etc.)
// TODO: Add API documentation module (Swagger/OpenAPI)
// TODO: Add security module with helmet, rate limiting, etc.
// TODO: Remove test controllers from production builds
// TODO: Add metrics and monitoring module (Prometheus, etc.)

//check
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './controllers/health.controller';
import { PlacesController } from './controllers/places.controller';
import { ChatController } from './controllers/chat.controller';
import { DatabaseModule } from './database/database.module';
import { DatabaseInit } from './database/database.init';
import { ItemsModule } from './items/items.module';
import { RedisModule } from './redis/redis.module';
import { RedisCacheModule } from './redis/redis-cache.module';
import { AuthController } from './controllers/auth.controller';
import { SessionController } from './controllers/session.controller';
import { RateLimitController } from './controllers/rate-limit.controller';
import { AuthModule } from './auth/auth.module';
// New comprehensive controllers
import { DonationsController } from './controllers/donations.controller';
import { RidesController } from './controllers/rides.controller';
import { UsersController } from './controllers/users.controller';
import { StatsController } from './controllers/stats.controller';
import { RedisTestController } from './controllers/redis-test.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    RedisModule,
    RedisCacheModule,
    AuthModule,
    ItemsModule,
  ],
  controllers: [
    HealthController, 
    PlacesController, 
    ChatController, 
    AuthController, 
    SessionController, 
    RateLimitController,
    // New comprehensive controllers
    DonationsController,
    RidesController,
    UsersController,
    StatsController,
    RedisTestController
  ],
  providers: [DatabaseInit],
})
export class AppModule {}


