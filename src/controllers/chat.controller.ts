// File overview:
// - Purpose: Chat API for conversations and messages with Postgres persistence and Redis caching.
// - Reached from: Routes under '/api/chat'.
// - Provides: Create conversation, list user conversations (with unread counts), send message, and cache invalidation.
// - Storage: Tables chat_conversations, chat_messages, message_read_receipts; caches keyed by user/patterns.
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { RedisCacheService } from '../redis/redis-cache.service';

@Controller('api/chat')
export class ChatController {
  private readonly CACHE_TTL = 2 * 60; // 2 minutes for chat data

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly redisCache: RedisCacheService,
  ) { }

  private async resolveUserId(userId: string): Promise<string> {
    // Check if it's already a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(userId)) {
      return userId;
    }

    const isEmail = userId.includes('@');

    // Use ONLY the real users table (not user_profiles)
    const { rows: existingUsers } = await this.pool.query(`
      SELECT user_id FROM users 
      WHERE 
        user_id = $1
        OR LOWER(data->>'email') = LOWER($1)
        OR data->>'googleId' = $1
        OR data->>'id' = $1
        OR data->'settings'->>'legacy_id' = $1
        OR data->'settings'->>'firebase_id' = $1
        OR data->'settings'->>'google_id' = $1
      LIMIT 1
    `, [userId]);

    if (existingUsers.length > 0) {
      return existingUsers[0].user_id;
    }

    // If user doesn't exist, return the userId as-is (don't create fake users)
    // The caller should handle missing users appropriately
    return userId;
  }

  @Post('conversations')
  async createConversation(@Body() conversationData: any) {
    const client = await this.pool.connect();

    // Resolve user IDs before starting transaction
    const resolvedCreatedBy = await this.resolveUserId(conversationData.created_by);
    const resolvedParticipants = await Promise.all(
      (conversationData.participants || []).map((p: string) => this.resolveUserId(p))
    );

    try {
      await client.query('BEGIN');

      const { rows } = await client.query(`
        INSERT INTO chat_conversations (title, type, participants, created_by, metadata)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [
        conversationData.title || null,
        conversationData.type || 'direct',
        resolvedParticipants,
        resolvedCreatedBy,
        conversationData.metadata ? JSON.stringify(conversationData.metadata) : null
      ]);

      const conversation = rows[0];

      await client.query(`
        INSERT INTO user_activities (user_id, activity_type, activity_data)
        VALUES ($1, $2, $3)
      `, [
        resolvedCreatedBy,
        'conversation_created',
        JSON.stringify({
          conversation_id: conversation.id,
          participants_count: resolvedParticipants.length
        })
      ]);

      await client.query('COMMIT');
      await this.clearChatCaches();

      return { success: true, data: conversation };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Create conversation error:', error);
      return { success: false, error: 'Failed to create conversation' };
    } finally {
      client.release();
    }
  }

  @Get('conversations/user/:userId')
  async getUserConversations(@Param('userId') userId: string) {
    // Resolve userId to actual user_id from users table (handles Google IDs, emails, etc.)
    const resolvedUserId = await this.resolveUserId(userId);

    const cacheKey = `user_conversations_${resolvedUserId}`;
    const cached = await this.redisCache.get(cacheKey);

    if (cached) {
      return { success: true, data: cached };
    }

    // Convert resolvedUserId to UUID if it's a valid UUID, otherwise use text comparison
    // Since user_id in users table is text (can be email or Google ID), we need to handle both cases
    const { rows } = await this.pool.query(`
      SELECT 
        cc.*,
        cm.content as last_message_content,
        cm.message_type as last_message_type,
        cm.created_at as last_message_time,
        COALESCE(u.data->>'name', 'ללא שם') as last_sender_name,
        (
          SELECT COUNT(*)
          FROM chat_messages cm2
          WHERE cm2.conversation_id = cc.id 
            AND cm2.sender_id::text != $1
            AND cm2.id NOT IN (
              SELECT message_id 
              FROM message_read_receipts 
              WHERE user_id::text = $1
            )
        ) as unread_count
      FROM chat_conversations cc
      LEFT JOIN chat_messages cm ON cc.last_message_id = cm.id
      LEFT JOIN users u ON cm.sender_id = u.user_id
      WHERE $1 = ANY(cc.participants)
      ORDER BY cc.last_message_at DESC
    `, [resolvedUserId]);

    await this.redisCache.set(cacheKey, rows, this.CACHE_TTL);
    return { success: true, data: rows };
  }

  @Post('messages')
  async sendMessage(@Body() messageData: any) {
    const client = await this.pool.connect();

    // Resolve sender ID before starting transaction
    const resolvedSenderId = await this.resolveUserId(messageData.sender_id);

    try {
      await client.query('BEGIN');

      const { rows } = await client.query(`
        INSERT INTO chat_messages (
          conversation_id, sender_id, content, message_type, 
          file_url, file_name, file_size, file_type, metadata, reply_to_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `, [
        messageData.conversation_id,
        resolvedSenderId,
        messageData.content,
        messageData.message_type || 'text',
        messageData.file_url || null,
        messageData.file_name || null,
        messageData.file_size || null,
        messageData.file_type || null,
        messageData.metadata ? JSON.stringify(messageData.metadata) : null,
        messageData.reply_to_id || null
      ]);

      const message = rows[0];

      await client.query(`
        UPDATE chat_conversations 
        SET last_message_id = $1, last_message_at = NOW(), updated_at = NOW()
        WHERE id = $2
      `, [message.id, messageData.conversation_id]);

      await client.query('COMMIT');
      await this.clearChatCaches();

      return { success: true, data: message };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Send message error:', error);
      return { success: false, error: 'Failed to send message' };
    } finally {
      client.release();
    }
  }

  private async clearChatCaches() {
    const patterns = [
      'user_conversations_*',
      'conversation_messages_*',
      'search_messages_*',
      'chat_stats_summary'
    ];

    for (const pattern of patterns) {
      const keys = await this.redisCache.getKeys(pattern);
      for (const key of keys) {
        await this.redisCache.delete(key);
      }
    }
  }
}