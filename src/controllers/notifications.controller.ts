import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    UseGuards,
    Inject,
    Query,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { RedisCacheService } from '../redis/redis-cache.service';
import { ThrottlerGuard } from '@nestjs/throttler';

@Controller('api/notifications')
@UseGuards(ThrottlerGuard)
export class NotificationsController {
    constructor(
        @Inject(PG_POOL) private readonly pool: Pool,
        private readonly redisCache: RedisCacheService,
    ) { }

    @Get(':userId')
    async getUserNotifications(
        @Param('userId') userId: string,
        @Query('limit') limit = '50',
        @Query('offset') offset = '0',
    ) {
        console.log(`📥 NotificationsController - getUserNotifications for userId: "${userId}"`);

        // Validate UUID format to prevent 500 errors
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(userId)) {
            console.warn(`⚠️ Invalid UUID provided: "${userId}"`);
            return { success: false, error: 'Invalid user ID format' };
        }

        try {
            const client = await this.pool.connect();
            try {
                const query = `
          SELECT 
            id,
            user_id as "userId",
            title,
            content as body,
            notification_type as type,
            related_id as "relatedId",
            is_read as read,
            metadata as data,
            created_at as timestamp
          FROM user_notifications
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3
        `;

                const { rows } = await client.query(query, [userId, parseInt(limit), parseInt(offset)]);

                return {
                    success: true,
                    data: rows.map(row => ({
                        ...row,
                        // Ensure data includes type for frontend compatibility
                        data: { ...(row.data || {}), type: row.type, relatedId: row.relatedId }
                    }))
                };
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error fetching notifications:', error);
            return { success: false, error: 'Failed to fetch notifications' };
        }
    }

    @Post(':userId/read-all')
    async markAllAsRead(@Param('userId') userId: string) {
        try {
            const client = await this.pool.connect();
            try {
                await client.query(
                    'UPDATE user_notifications SET is_read = true, read_at = NOW() WHERE user_id = $1',
                    [userId]
                );
                return { success: true };
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error marking all notifications as read:', error);
            return { success: false, error: 'Failed to mark notifications as read' };
        }
    }

    @Put(':userId/:notificationId/read')
    async markAsRead(
        @Param('userId') userId: string,
        @Param('notificationId') notificationId: string
    ) {
        try {
            const client = await this.pool.connect();
            try {
                await client.query(
                    'UPDATE user_notifications SET is_read = true, read_at = NOW() WHERE id = $1 AND user_id = $2',
                    [notificationId, userId]
                );
                return { success: true };
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error marking notification as read:', error);
            return { success: false, error: 'Failed to mark notification as read' };
        }
    }

    @Delete(':userId/:notificationId')
    async deleteNotification(
        @Param('userId') userId: string,
        @Param('notificationId') notificationId: string
    ) {
        try {
            const client = await this.pool.connect();
            try {
                await client.query(
                    'DELETE FROM user_notifications WHERE id = $1 AND user_id = $2',
                    [notificationId, userId]
                );
                return { success: true };
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error deleting notification:', error);
            return { success: false, error: 'Failed to delete notification' };
        }
    }

    @Delete(':userId')
    async clearAllNotifications(@Param('userId') userId: string) {
        try {
            const client = await this.pool.connect();
            try {
                await client.query(
                    'DELETE FROM user_notifications WHERE user_id = $1',
                    [userId]
                );
                return { success: true };
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error clearing notifications:', error);
            return { success: false, error: 'Failed to clear notifications' };
        }
    }
}
