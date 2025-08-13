// File overview:
// - Purpose: Nest module bundling generic items CRUD and Redis-based helpers.
// - Reached from: Imported by `AppModule` to expose /api generic collection endpoints.
// - Provides: `ItemsController`, `ItemsService`; imports `RedisCacheModule` for caching.
// - Downstream: Used by clients via `/api/:collection` routes and Redis demo endpoints.
import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { RedisCacheModule } from '../redis/redis-cache.module';

@Module({
  imports: [RedisCacheModule],
  controllers: [ItemsController],
  providers: [ItemsService],
})
export class ItemsModule {}


