import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './controllers/health.controller';
import { PlacesController } from './controllers/places.controller';
import { ChatController } from './controllers/chat.controller';
import { DatabaseModule } from './database/database.module';
import { DatabaseInit } from './database/database.init';
import { ItemsModule } from './items/items.module';
import { RedisModule } from './redis/redis.module';
import { AuthController } from './controllers/auth.controller';
import { RedisTestController } from './controllers/redis-test.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    RedisModule,
    ItemsModule,
  ],
  controllers: [HealthController, PlacesController, ChatController, AuthController, RedisTestController],
  providers: [DatabaseInit],
})
export class AppModule {}


