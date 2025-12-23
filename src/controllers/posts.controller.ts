import { Controller, Get, Param, Query, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

@Controller('api/posts')
export class PostsController {
    constructor(@Inject(PG_POOL) private readonly pool: Pool) { }

    /**
     * Ensure posts table exists with correct schema, create/migrate if needed
     */
    private async ensurePostsTable() {
        try {
            // Check if posts table exists and has correct structure
            const tableCheck = await this.pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_name = 'posts'
                ) AS exists;
            `);

            if (tableCheck.rows[0]?.exists) {
                // Check if it has the correct structure (author_id column)
                const columnCheck = await this.pool.query(`
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.columns 
                        WHERE table_name = 'posts' AND column_name = 'author_id'
                    ) AS exists;
                `);

                if (!columnCheck.rows[0]?.exists) {
                    // Legacy table exists with wrong structure - drop and recreate
                    console.log('⚠️  Detected legacy posts table structure - recreating with correct schema');
                    await this.pool.query('DROP TABLE IF EXISTS posts CASCADE;');
                } else {
                    // Table exists with correct structure
                    return;
                }
            }

            // Create posts table with correct schema
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS posts (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    author_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
                    title VARCHAR(255) NOT NULL,
                    description TEXT,
                    images TEXT[],
                    likes INTEGER DEFAULT 0,
                    comments INTEGER DEFAULT 0,
                    post_type VARCHAR(50) DEFAULT 'task_completion',
                    metadata JSONB DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);

            // Create indexes
            const indexes = [
                'idx_posts_author_id ON posts(author_id)',
                'idx_posts_task_id ON posts(task_id)',
                'idx_posts_created_at ON posts(created_at DESC)',
                'idx_posts_post_type ON posts(post_type)'
            ];

            for (const idx of indexes) {
                try {
                    await this.pool.query(`CREATE INDEX IF NOT EXISTS ${idx};`);
                } catch (e) {
                    console.log(`⚠️ Skipping index ${idx}`);
                }
            }

            // Create trigger for updated_at
            try {
                await this.pool.query(`
                    DROP TRIGGER IF EXISTS update_posts_updated_at ON posts;
                    CREATE TRIGGER update_posts_updated_at 
                        BEFORE UPDATE ON posts 
                        FOR EACH ROW 
                        EXECUTE FUNCTION update_updated_at_column();
                `);
            } catch (e) {
                console.log('⚠️ Could not create update_posts_updated_at trigger (function might not exist)');
            }

            console.log('✅ Posts table ensured with correct schema');
        } catch (error) {
            console.error('❌ Failed to ensure posts table:', error);
            // Don't throw - allow code to continue, but log the error
        }
    }

    @Get()
    async getPosts(@Query('limit') limitArg: string, @Query('offset') offsetArg: string) {
        try {
            // Ensure posts table exists before querying
            await this.ensurePostsTable();
            
            const limit = parseInt(limitArg) || 20;
            const offset = parseInt(offsetArg) || 0;

            const { rows } = await this.pool.query(`
        SELECT 
          p.*,
          json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url) as author,
          CASE WHEN t.id IS NOT NULL THEN json_build_object('id', t.id, 'title', t.title, 'status', t.status) ELSE NULL END as task
        FROM posts p
        JOIN user_profiles u ON p.author_id = u.id
        LEFT JOIN tasks t ON p.task_id = t.id
        ORDER BY p.created_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]);
            return { success: true, data: rows };
        } catch (error) {
            console.error('Get posts error:', error);
            return { success: false, error: 'Failed' };
        }
    }

    @Get('user/:userId')
    async getUserPosts(@Param('userId') userId: string, @Query('limit') limitArg: string) {
        try {
            // Ensure posts table exists before querying
            await this.ensurePostsTable();
            
            const limit = parseInt(limitArg) || 20;
            const { rows } = await this.pool.query(`
        SELECT 
          p.*,
          json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url) as author,
          CASE WHEN t.id IS NOT NULL THEN json_build_object('id', t.id, 'title', t.title, 'status', t.status) ELSE NULL END as task
        FROM posts p
        JOIN user_profiles u ON p.author_id = u.id
        LEFT JOIN tasks t ON p.task_id = t.id
        WHERE p.author_id = $1
        ORDER BY p.created_at DESC
        LIMIT $2
      `, [userId, limit]);
            return { success: true, data: rows };
        } catch (error) {
            console.error('Get user posts error:', error);
            return { success: false, error: 'Failed' };
        }
    }
}
