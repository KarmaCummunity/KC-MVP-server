import { Controller, Get, Post, Put, Delete, Param, Query, Body, Inject, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { RedisCacheService } from '../redis/redis-cache.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface LikeBody {
    user_id: string;
}

interface CommentBody {
    user_id: string;
    text: string;
}

interface UpdateCommentBody {
    user_id: string;
    text: string;
}

@Controller('api/posts')
export class PostsController {
    private readonly CACHE_TTL = 5 * 60; // 5 minutes cache

    constructor(
        @Inject(PG_POOL) private readonly pool: Pool,
        private readonly redisCache: RedisCacheService,
    ) { }

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

    /**
     * Ensure likes and comments tables exist
     */
    private async ensureLikesCommentsTable() {
        try {
            // Check if post_likes table exists
            const likesTableCheck = await this.pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_name = 'post_likes'
                ) AS exists;
            `);

            if (!likesTableCheck.rows[0]?.exists) {
                console.log('📝 Creating post_likes table...');
                await this.pool.query(`
                    CREATE TABLE IF NOT EXISTS post_likes (
                        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                        post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                        user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        UNIQUE(post_id, user_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);
                    CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON post_likes(user_id);
                `);
                console.log('✅ post_likes table created');
            }

            // Check if post_comments table exists
            const commentsTableCheck = await this.pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_name = 'post_comments'
                ) AS exists;
            `);

            if (!commentsTableCheck.rows[0]?.exists) {
                console.log('📝 Creating post_comments table...');
                await this.pool.query(`
                    CREATE TABLE IF NOT EXISTS post_comments (
                        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                        post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                        user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                        text TEXT NOT NULL CHECK (char_length(text) > 0 AND char_length(text) <= 2000),
                        likes_count INTEGER DEFAULT 0,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW()
                    );
                    CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments(post_id);
                    CREATE INDEX IF NOT EXISTS idx_post_comments_user_id ON post_comments(user_id);
                    CREATE INDEX IF NOT EXISTS idx_post_comments_created_at ON post_comments(created_at DESC);
                `);
                console.log('✅ post_comments table created');
            }

            // Check if comment_likes table exists
            const commentLikesTableCheck = await this.pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_name = 'comment_likes'
                ) AS exists;
            `);

            if (!commentLikesTableCheck.rows[0]?.exists) {
                console.log('📝 Creating comment_likes table...');
                await this.pool.query(`
                    CREATE TABLE IF NOT EXISTS comment_likes (
                        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                        comment_id UUID NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
                        user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        UNIQUE(comment_id, user_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON comment_likes(comment_id);
                    CREATE INDEX IF NOT EXISTS idx_comment_likes_user_id ON comment_likes(user_id);
                `);
                console.log('✅ comment_likes table created');
            }

            // Create SQL functions for updating counts
            console.log('📝 Ensuring SQL functions exist...');

            // Function to update post likes count
            await this.pool.query(`
                CREATE OR REPLACE FUNCTION update_post_likes_count()
                RETURNS TRIGGER AS $$
                BEGIN
                    IF TG_OP = 'INSERT' THEN
                        UPDATE posts SET likes = likes + 1, updated_at = NOW() WHERE id = NEW.post_id;
                        RETURN NEW;
                    ELSIF TG_OP = 'DELETE' THEN
                        UPDATE posts SET likes = GREATEST(0, likes - 1), updated_at = NOW() WHERE id = OLD.post_id;
                        RETURN OLD;
                    END IF;
                    RETURN NULL;
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Function to update post comments count
            await this.pool.query(`
                CREATE OR REPLACE FUNCTION update_post_comments_count()
                RETURNS TRIGGER AS $$
                BEGIN
                    IF TG_OP = 'INSERT' THEN
                        UPDATE posts SET comments = comments + 1, updated_at = NOW() WHERE id = NEW.post_id;
                        RETURN NEW;
                    ELSIF TG_OP = 'DELETE' THEN
                        UPDATE posts SET comments = GREATEST(0, comments - 1), updated_at = NOW() WHERE id = OLD.post_id;
                        RETURN OLD;
                    END IF;
                    RETURN NULL;
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Function to update comment likes count
            await this.pool.query(`
                CREATE OR REPLACE FUNCTION update_comment_likes_count()
                RETURNS TRIGGER AS $$
                BEGIN
                    IF TG_OP = 'INSERT' THEN
                        UPDATE post_comments SET likes_count = likes_count + 1, updated_at = NOW() WHERE id = NEW.comment_id;
                        RETURN NEW;
                    ELSIF TG_OP = 'DELETE' THEN
                        UPDATE post_comments SET likes_count = GREATEST(0, likes_count - 1), updated_at = NOW() WHERE id = OLD.comment_id;
                        RETURN OLD;
                    END IF;
                    RETURN NULL;
                END;
                $$ LANGUAGE plpgsql;
            `);

            console.log('✅ SQL functions ensured');

            // Create triggers
            console.log('📝 Ensuring triggers exist...');

            // Trigger for post_likes
            await this.pool.query(`
                DROP TRIGGER IF EXISTS trigger_update_post_likes_count ON post_likes;
                CREATE TRIGGER trigger_update_post_likes_count
                    AFTER INSERT OR DELETE ON post_likes
                    FOR EACH ROW
                    EXECUTE FUNCTION update_post_likes_count();
            `);

            // Trigger for post_comments
            await this.pool.query(`
                DROP TRIGGER IF EXISTS trigger_update_post_comments_count ON post_comments;
                CREATE TRIGGER trigger_update_post_comments_count
                    AFTER INSERT OR DELETE ON post_comments
                    FOR EACH ROW
                    EXECUTE FUNCTION update_post_comments_count();
            `);

            // Trigger for comment_likes
            await this.pool.query(`
                DROP TRIGGER IF EXISTS trigger_update_comment_likes_count ON comment_likes;
                CREATE TRIGGER trigger_update_comment_likes_count
                    AFTER INSERT OR DELETE ON comment_likes
                    FOR EACH ROW
                    EXECUTE FUNCTION update_comment_likes_count();
            `);

            // Trigger for post_comments updated_at
            await this.pool.query(`
                DROP TRIGGER IF EXISTS update_post_comments_updated_at ON post_comments;
                CREATE TRIGGER update_post_comments_updated_at 
                    BEFORE UPDATE ON post_comments 
                    FOR EACH ROW 
                    EXECUTE FUNCTION update_updated_at_column();
            `).catch(() => {
                // Function might not exist, that's okay
                console.log('⚠️ update_updated_at_column function not found, skipping trigger');
            });

            console.log('✅ Triggers ensured');
        } catch (error) {
            console.error('❌ Failed to ensure likes/comments tables:', error);
        }
    }

    // ============================================
    // POSTS ENDPOINTS
    // ============================================

    @Get()
    async getPosts(
        @Query('limit') limitArg: string,
        @Query('offset') offsetArg: string,
        @Query('user_id') userId?: string
    ) {
        try {
            await this.ensurePostsTable();
            await this.ensureLikesCommentsTable();

            const limit = parseInt(limitArg) || 20;
            const offset = parseInt(offsetArg) || 0;

            // Build query with optional user_id for checking if user liked each post
            let query = `
                SELECT 
                    p.*,
                    CASE 
                        WHEN u.id IS NOT NULL THEN json_build_object('id', u.id, 'name', COALESCE(u.name, 'ללא שם'), 'avatar_url', COALESCE(u.avatar_url, ''))
                        ELSE json_build_object('id', p.author_id, 'name', 'משתמש לא נמצא', 'avatar_url', '')
                    END as author,
                    CASE WHEN t.id IS NOT NULL THEN json_build_object('id', t.id, 'title', t.title, 'status', t.status) ELSE NULL END as task
            `;

            if (userId) {
                query += `,
                    EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $3) as is_liked
                `;
            } else {
                query += `,
                    false as is_liked
                `;
            }

            query += `
                FROM posts p
                LEFT JOIN user_profiles u ON p.author_id = u.id
                LEFT JOIN tasks t ON p.task_id = t.id
                ORDER BY p.created_at DESC
                LIMIT $1 OFFSET $2
            `;

            const params = userId ? [limit, offset, userId] : [limit, offset];
            const { rows } = await this.pool.query(query, params);

            return { success: true, data: rows };
        } catch (error) {
            console.error('Get posts error:', error);
            return { success: false, error: 'Failed to get posts' };
        }
    }

    @Get('user/:userId')
    async getUserPosts(
        @Param('userId') userId: string,
        @Query('limit') limitArg: string,
        @Query('viewer_id') viewerId?: string
    ) {
        try {
            await this.ensurePostsTable();
            await this.ensureLikesCommentsTable();

            const limit = parseInt(limitArg) || 20;

            let query = `
                SELECT 
                    p.*,
                    CASE 
                        WHEN u.id IS NOT NULL THEN json_build_object('id', u.id, 'name', COALESCE(u.name, 'ללא שם'), 'avatar_url', COALESCE(u.avatar_url, ''))
                        ELSE json_build_object('id', p.author_id, 'name', 'משתמש לא נמצא', 'avatar_url', '')
                    END as author,
                    CASE WHEN t.id IS NOT NULL THEN json_build_object('id', t.id, 'title', t.title, 'status', t.status) ELSE NULL END as task
            `;

            if (viewerId) {
                query += `,
                    EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $3) as is_liked
                `;
            } else {
                query += `,
                    false as is_liked
                `;
            }

            query += `
                FROM posts p
                LEFT JOIN user_profiles u ON p.author_id = u.id
                LEFT JOIN tasks t ON p.task_id = t.id
                WHERE p.author_id = $1
                ORDER BY p.created_at DESC
                LIMIT $2
            `;

            const params = viewerId ? [userId, limit, viewerId] : [userId, limit];
            const { rows } = await this.pool.query(query, params);

            return { success: true, data: rows };
        } catch (error) {
            console.error('Get user posts error:', error);
            return { success: false, error: 'Failed to get user posts' };
        }
    }

    // ============================================
    // LIKES ENDPOINTS
    // ============================================

    /**
     * Toggle like on a post (like if not liked, unlike if already liked)
     * POST /api/posts/:postId/like
     */
    @Post(':postId/like')
    @UseGuards(JwtAuthGuard)
    async toggleLike(@Param('postId') postId: string, @Body() body: LikeBody) {
        const client = await this.pool.connect();
        try {
            await this.ensureLikesCommentsTable();

            const { user_id } = body;
            if (!user_id) {
                return { success: false, error: 'user_id is required' };
            }

            await client.query('BEGIN');

            // Check if post exists
            const postCheck = await client.query(
                'SELECT id, author_id, title, post_type FROM posts WHERE id = $1',
                [postId]
            );
            if (postCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Post not found' };
            }

            // Check if user exists
            const userCheck = await client.query(
                'SELECT id, name FROM user_profiles WHERE id = $1',
                [user_id]
            );
            if (userCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'User not found' };
            }

            // Check if like already exists
            const existingLike = await client.query(
                'SELECT id FROM post_likes WHERE post_id = $1 AND user_id = $2',
                [postId, user_id]
            );

            let isLiked: boolean;

            if (existingLike.rows.length > 0) {
                // Unlike - remove the like
                await client.query(
                    'DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2',
                    [postId, user_id]
                );
                isLiked = false;
            } else {
                // Like - add new like
                await client.query(
                    'INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)',
                    [postId, user_id]
                );
                isLiked = true;

                // Send notification to post author if it's not the same user
                const post = postCheck.rows[0];
                const user = userCheck.rows[0];

                if (post.author_id !== user_id) {
                    const likerName = user.name || 'משתמש';
                    const postType = post.post_type === 'task_completion' ? 'השלמת משימה' : 'פוסט';

                    await client.query(`
                        INSERT INTO user_notifications (user_id, title, content, notification_type, related_id, metadata)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT DO NOTHING
                    `, [
                        post.author_id,
                        'לייק חדש!',
                        `${likerName} אהב/ה את ה${postType} שלך: "${post.title}"`,
                        'like',
                        postId,
                        { liker_id: user_id, post_id: postId }
                    ]);
                }
            }

            // Calculate likes count from post_likes table (more reliable than reading from posts.likes)
            const countResult = await client.query(
                'SELECT COUNT(*)::int as count FROM post_likes WHERE post_id = $1',
                [postId]
            );
            const likesCount = countResult.rows[0]?.count || 0;

            // Update posts.likes manually as fallback (in case trigger didn't fire)
            await client.query(
                'UPDATE posts SET likes = $1, updated_at = NOW() WHERE id = $2',
                [likesCount, postId]
            );

            await client.query('COMMIT');

            // Clear cache
            await this.redisCache.delete(`post_likes_${postId}`);

            return {
                success: true,
                data: {
                    post_id: postId,
                    is_liked: isLiked,
                    likes_count: likesCount
                }
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Toggle like error:', error);
            return { success: false, error: 'Failed to toggle like' };
        } finally {
            client.release();
        }
    }

    /**
     * Get users who liked a post
     * GET /api/posts/:postId/likes
     */
    @Get(':postId/likes')
    async getPostLikes(
        @Param('postId') postId: string,
        @Query('limit') limitArg: string,
        @Query('offset') offsetArg: string
    ) {
        try {
            await this.ensureLikesCommentsTable();

            const limit = parseInt(limitArg) || 50;
            const offset = parseInt(offsetArg) || 0;

            const { rows } = await this.pool.query(`
                SELECT 
                    pl.id,
                    pl.created_at,
                    json_build_object(
                        'id', u.id,
                        'name', u.name,
                        'avatar_url', u.avatar_url
                    ) as user
                FROM post_likes pl
                JOIN user_profiles u ON pl.user_id = u.id
                WHERE pl.post_id = $1
                ORDER BY pl.created_at DESC
                LIMIT $2 OFFSET $3
            `, [postId, limit, offset]);

            // Get total count
            const countResult = await this.pool.query(
                'SELECT COUNT(*) as total FROM post_likes WHERE post_id = $1',
                [postId]
            );

            return {
                success: true,
                data: rows,
                total: parseInt(countResult.rows[0]?.total || '0')
            };
        } catch (error) {
            console.error('Get post likes error:', error);
            return { success: false, error: 'Failed to get likes' };
        }
    }

    /**
     * Check if user liked a post
     * GET /api/posts/:postId/likes/check/:userId
     */
    @Get(':postId/likes/check/:userId')
    async checkUserLiked(@Param('postId') postId: string, @Param('userId') userId: string) {
        try {
            await this.ensureLikesCommentsTable();

            const result = await this.pool.query(
                'SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2) as is_liked',
                [postId, userId]
            );

            return {
                success: true,
                data: {
                    post_id: postId,
                    user_id: userId,
                    is_liked: result.rows[0]?.is_liked || false
                }
            };
        } catch (error) {
            console.error('Check user liked error:', error);
            return { success: false, error: 'Failed to check like status' };
        }
    }

    // ============================================
    // COMMENTS ENDPOINTS
    // ============================================

    /**
     * Add a comment to a post
     * POST /api/posts/:postId/comments
     */
    @Post(':postId/comments')
    @UseGuards(JwtAuthGuard)
    async addComment(@Param('postId') postId: string, @Body() body: CommentBody) {
        const client = await this.pool.connect();
        try {
            await this.ensureLikesCommentsTable();

            const { user_id, text } = body;

            if (!user_id) {
                return { success: false, error: 'user_id is required' };
            }

            if (!text || text.trim().length === 0) {
                return { success: false, error: 'Comment text is required' };
            }

            if (text.length > 2000) {
                return { success: false, error: 'Comment text is too long (max 2000 characters)' };
            }

            await client.query('BEGIN');

            // Check if post exists
            const postCheck = await client.query(
                'SELECT id, author_id, title, post_type FROM posts WHERE id = $1',
                [postId]
            );
            if (postCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Post not found' };
            }

            // Check if user exists
            const userCheck = await client.query(
                'SELECT id, name FROM user_profiles WHERE id = $1',
                [user_id]
            );
            if (userCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'User not found' };
            }

            // Insert comment
            const { rows } = await client.query(`
                INSERT INTO post_comments (post_id, user_id, text)
                VALUES ($1, $2, $3)
                RETURNING *
            `, [postId, user_id, text.trim()]);

            const comment = rows[0];

            // Get user info for the response
            const userResult = await client.query(`
                SELECT id, name, avatar_url FROM user_profiles WHERE id = $1
            `, [user_id]);

            // Calculate comments count from post_comments table (more reliable than reading from posts.comments)
            const countResult = await client.query(
                'SELECT COUNT(*)::int as count FROM post_comments WHERE post_id = $1',
                [postId]
            );
            const commentsCount = countResult.rows[0]?.count || 0;

            // Update posts.comments manually as fallback (in case trigger didn't fire)
            await client.query(
                'UPDATE posts SET comments = $1, updated_at = NOW() WHERE id = $2',
                [commentsCount, postId]
            );

            // Send notification to post author if not same user
            const post = postCheck.rows[0];
            const user = userCheck.rows[0];

            if (post.author_id !== user_id) {
                const commenterName = user.name || 'משתמש';
                const postType = post.post_type === 'task_completion' ? 'השלמת משימה' : 'פוסט';

                await client.query(`
                    INSERT INTO user_notifications (user_id, title, content, notification_type, related_id, metadata)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                    post.author_id,
                    'תגובה חדשה!',
                    `${commenterName} הגיב/ה על ה${postType} שלך: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`,
                    'comment',
                    postId,
                    { commenter_id: user_id, post_id: postId, comment_id: comment.id }
                ]);
            }

            await client.query('COMMIT');

            // Clear cache
            await this.redisCache.delete(`post_comments_${postId}`);

            return {
                success: true,
                data: {
                    ...comment,
                    user: userResult.rows[0] || null,
                    comments_count: commentsCount
                }
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Add comment error:', error);
            return { success: false, error: 'Failed to add comment' };
        } finally {
            client.release();
        }
    }

    /**
     * Get all comments for a post
     * GET /api/posts/:postId/comments
     */
    @Get(':postId/comments')
    async getPostComments(
        @Param('postId') postId: string,
        @Query('limit') limitArg: string,
        @Query('offset') offsetArg: string,
        @Query('viewer_id') viewerId?: string
    ) {
        try {
            await this.ensureLikesCommentsTable();

            const limit = parseInt(limitArg) || 50;
            const offset = parseInt(offsetArg) || 0;

            let query = `
                SELECT 
                    c.id,
                    c.post_id,
                    c.user_id,
                    c.text,
                    c.likes_count,
                    c.created_at,
                    c.updated_at,
                    json_build_object(
                        'id', u.id,
                        'name', u.name,
                        'avatar_url', u.avatar_url
                    ) as user
            `;

            // Add is_liked if viewer_id is provided
            if (viewerId) {
                query += `,
                    EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = $4) as is_liked
                `;
            } else {
                query += `,
                    false as is_liked
                `;
            }

            query += `
                FROM post_comments c
                JOIN user_profiles u ON c.user_id = u.id
                WHERE c.post_id = $1
                ORDER BY c.created_at ASC
                LIMIT $2 OFFSET $3
            `;

            const params = viewerId ? [postId, limit, offset, viewerId] : [postId, limit, offset];
            const { rows } = await this.pool.query(query, params);

            // Get total count
            const countResult = await this.pool.query(
                'SELECT COUNT(*) as total FROM post_comments WHERE post_id = $1',
                [postId]
            );

            return {
                success: true,
                data: rows,
                total: parseInt(countResult.rows[0]?.total || '0')
            };
        } catch (error) {
            console.error('Get post comments error:', error);
            return { success: false, error: 'Failed to get comments' };
        }
    }

    /**
     * Update a comment (only owner can update)
     * PUT /api/posts/:postId/comments/:commentId
     */
    @Put(':postId/comments/:commentId')
    @UseGuards(JwtAuthGuard)
    async updateComment(
        @Param('postId') postId: string,
        @Param('commentId') commentId: string,
        @Body() body: UpdateCommentBody
    ) {
        try {
            await this.ensureLikesCommentsTable();

            const { user_id, text } = body;

            if (!user_id) {
                return { success: false, error: 'user_id is required' };
            }

            if (!text || text.trim().length === 0) {
                return { success: false, error: 'Comment text is required' };
            }

            if (text.length > 2000) {
                return { success: false, error: 'Comment text is too long (max 2000 characters)' };
            }

            // Check if comment exists and belongs to user
            const existingComment = await this.pool.query(
                'SELECT id, user_id FROM post_comments WHERE id = $1 AND post_id = $2',
                [commentId, postId]
            );

            if (existingComment.rows.length === 0) {
                return { success: false, error: 'Comment not found' };
            }

            if (existingComment.rows[0].user_id !== user_id) {
                return { success: false, error: 'You can only edit your own comments' };
            }

            // Update comment
            const { rows } = await this.pool.query(`
                UPDATE post_comments 
                SET text = $1, updated_at = NOW()
                WHERE id = $2
                RETURNING *
            `, [text.trim(), commentId]);

            // Clear cache
            await this.redisCache.delete(`post_comments_${postId}`);

            return { success: true, data: rows[0] };
        } catch (error) {
            console.error('Update comment error:', error);
            return { success: false, error: 'Failed to update comment' };
        }
    }

    /**
     * Delete a comment (only owner can delete)
     * DELETE /api/posts/:postId/comments/:commentId
     */
    @Delete(':postId/comments/:commentId')
    @UseGuards(JwtAuthGuard)
    async deleteComment(
        @Param('postId') postId: string,
        @Param('commentId') commentId: string,
        @Query('user_id') userId: string
    ) {
        const client = await this.pool.connect();
        try {
            await this.ensureLikesCommentsTable();

            if (!userId) {
                return { success: false, error: 'user_id is required' };
            }

            await client.query('BEGIN');

            // Check if comment exists and belongs to user
            const existingComment = await client.query(
                'SELECT id, user_id FROM post_comments WHERE id = $1 AND post_id = $2',
                [commentId, postId]
            );

            if (existingComment.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Comment not found' };
            }

            if (existingComment.rows[0].user_id !== userId) {
                await client.query('ROLLBACK');
                return { success: false, error: 'You can only delete your own comments' };
            }

            // Delete comment (trigger will update count)
            await client.query(
                'DELETE FROM post_comments WHERE id = $1',
                [commentId]
            );

            // Calculate comments count from post_comments table (more reliable than reading from posts.comments)
            const countResult = await client.query(
                'SELECT COUNT(*)::int as count FROM post_comments WHERE post_id = $1',
                [postId]
            );
            const commentsCount = countResult.rows[0]?.count || 0;

            // Update posts.comments manually as fallback (in case trigger didn't fire)
            await client.query(
                'UPDATE posts SET comments = $1, updated_at = NOW() WHERE id = $2',
                [commentsCount, postId]
            );

            await client.query('COMMIT');

            // Clear cache
            await this.redisCache.delete(`post_comments_${postId}`);

            return {
                success: true,
                data: {
                    deleted_comment_id: commentId,
                    comments_count: commentsCount
                }
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Delete comment error:', error);
            return { success: false, error: 'Failed to delete comment' };
        } finally {
            client.release();
        }
    }

    // ============================================
    // COMMENT LIKES ENDPOINTS
    // ============================================

    /**
     * Toggle like on a comment
     * POST /api/posts/:postId/comments/:commentId/like
     */
    @Post(':postId/comments/:commentId/like')
    @UseGuards(JwtAuthGuard)
    async toggleCommentLike(
        @Param('postId') postId: string,
        @Param('commentId') commentId: string,
        @Body() body: LikeBody
    ) {
        const client = await this.pool.connect();
        try {
            await this.ensureLikesCommentsTable();

            const { user_id } = body;
            if (!user_id) {
                return { success: false, error: 'user_id is required' };
            }

            await client.query('BEGIN');

            // Check if comment exists
            const commentCheck = await client.query(
                'SELECT id, user_id, text FROM post_comments WHERE id = $1 AND post_id = $2',
                [commentId, postId]
            );
            if (commentCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Comment not found' };
            }

            // Check if user exists
            const userCheck = await client.query(
                'SELECT id, name FROM user_profiles WHERE id = $1',
                [user_id]
            );
            if (userCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'User not found' };
            }

            // Check if like already exists
            const existingLike = await client.query(
                'SELECT id FROM comment_likes WHERE comment_id = $1 AND user_id = $2',
                [commentId, user_id]
            );

            let isLiked: boolean;

            if (existingLike.rows.length > 0) {
                // Unlike - remove the like
                await client.query(
                    'DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2',
                    [commentId, user_id]
                );
                isLiked = false;
            } else {
                // Like - add new like
                await client.query(
                    'INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2)',
                    [commentId, user_id]
                );
                isLiked = true;

                // Send notification to comment author if not same user
                const comment = commentCheck.rows[0];
                const user = userCheck.rows[0];

                if (comment.user_id !== user_id) {
                    const likerName = user.name || 'משתמש';

                    await client.query(`
                        INSERT INTO user_notifications (user_id, title, content, notification_type, related_id, metadata)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT DO NOTHING
                    `, [
                        comment.user_id,
                        'לייק לתגובה!',
                        `${likerName} אהב/ה את התגובה שלך: "${comment.text.substring(0, 30)}${comment.text.length > 30 ? '...' : ''}"`,
                        'like',
                        postId,
                        { liker_id: user_id, post_id: postId, comment_id: commentId }
                    ]);
                }
            }

            // Calculate likes count from comment_likes table (more reliable than reading from post_comments.likes_count)
            const countResult = await client.query(
                'SELECT COUNT(*)::int as count FROM comment_likes WHERE comment_id = $1',
                [commentId]
            );
            const likesCount = countResult.rows[0]?.count || 0;

            // Update post_comments.likes_count manually as fallback (in case trigger didn't fire)
            await client.query(
                'UPDATE post_comments SET likes_count = $1, updated_at = NOW() WHERE id = $2',
                [likesCount, commentId]
            );

            await client.query('COMMIT');

            return {
                success: true,
                data: {
                    comment_id: commentId,
                    is_liked: isLiked,
                    likes_count: likesCount
                }
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Toggle comment like error:', error);
            return { success: false, error: 'Failed to toggle comment like' };
        } finally {
            client.release();
        }
    }
}
