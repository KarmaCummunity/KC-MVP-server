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
import { RedisTestController } from './controllers/redis-test.controller';
import { SessionController } from './controllers/session.controller';
import { RateLimitController } from './controllers/rate-limit.controller';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    RedisModule,
    RedisCacheModule,
    AuthModule,
    ItemsModule,
  ],
  controllers: [HealthController, PlacesController, ChatController, AuthController, RedisTestController, SessionController, RateLimitController],
  providers: [DatabaseInit],
})
export class AppModule {}


