import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ItemsService } from './items.service';
import { QueryByUserDto, UpsertItemDto } from './dto/item.dto';

@Controller('api')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  // Generic CRUD mapped to collections in query param
  @Get(':collection/:userId/:itemId')
  async read(
    @Param('collection') collection: string,
    @Param('userId') userId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.itemsService.read(collection, userId, itemId);
  }

  @Get(':collection')
  async list(@Param('collection') collection: string, @Query() query: QueryByUserDto) {
    return this.itemsService.list(collection, query.userId, query.q);
  }

  @Post(':collection')
  async create(@Param('collection') collection: string, @Body() dto: UpsertItemDto) {
    return this.itemsService.create(collection, dto.userId, dto.id, dto.data);
  }

  @Put(':collection/:userId/:itemId')
  async update(
    @Param('collection') collection: string,
    @Param('userId') userId: string,
    @Param('itemId') itemId: string,
    @Body('data') data: Record<string, unknown>,
  ) {
    return this.itemsService.update(collection, userId, itemId, data);
  }

  @Delete(':collection/:userId/:itemId')
  async remove(
    @Param('collection') collection: string,
    @Param('userId') userId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.itemsService.delete(collection, userId, itemId);
  }

  // Redis-powered endpoints
  
  @Get('user-activity/:userId')
  async getUserActivity(@Param('userId') userId: string) {
    try {
      const activity = await this.itemsService.getUserActivity(userId);
      return {
        success: true,
        userId,
        ...activity,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  @Get('popular-collections')
  async getPopularCollections() {
    try {
      const collections = await this.itemsService.getPopularCollections();
      return {
        success: true,
        collections,
        total: collections.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  @Get('cache-stats')
  async getCacheStats() {
    try {
      const stats = await this.itemsService.getCacheStats();
      return {
        success: true,
        stats,
        message: 'Redis cache statistics',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}


