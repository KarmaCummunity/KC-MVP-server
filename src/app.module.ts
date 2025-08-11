import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './controllers/health.controller';
import { PlacesController } from './controllers/places.controller';
import { ChatController } from './controllers/chat.controller';
import { DatabaseModule } from './database/database.module';
import { ItemsModule } from './items/items.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    RedisModule,
    ItemsModule,
  ],
  controllers: [HealthController, PlacesController, ChatController],
})
export class AppModule {}


