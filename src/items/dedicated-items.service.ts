// File overview:
// - Purpose: Service for dedicated items table with separate columns (not JSONB)
// - Provides: CRUD operations for items with all fields as separate database columns
// - External deps: PostgreSQL connection pool
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { CreateItemDto, UpdateItemDto } from './dto/dedicated-item.dto';

@Injectable()
export class DedicatedItemsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Create a new item with all fields as separate columns
   */
  async createItem(dto: CreateItemDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // CRITICAL: Ensure user exists in user_profiles with firebase_uid
      // This is essential for the JOIN to work correctly when fetching items
      let ownerName = 'לא זמין';
      let ownerExists = false;
      
      try {
        // Check if user exists with this firebase_uid, google_id, email, or UUID
        const ownerResult = await client.query(
          `SELECT id, name, email, firebase_uid, google_id FROM user_profiles 
           WHERE firebase_uid = $1 OR google_id = $1 OR LOWER(email) = LOWER($1) OR id::text = $1 
           LIMIT 1`,
          [dto.owner_id]
        );
        
        if (ownerResult.rows.length > 0) {
          ownerExists = true;
          const owner = ownerResult.rows[0];
          ownerName = owner.name || 'ללא שם';
          
          // If user exists but firebase_uid is missing, update it
          if (!owner.firebase_uid && dto.owner_id && dto.owner_id.length > 20) {
            // This looks like a Firebase UID (long string), update the user
            console.log(`🔄 Updating user ${owner.id} with firebase_uid: ${dto.owner_id}`);
            await client.query(
              `UPDATE user_profiles 
               SET firebase_uid = $1, updated_at = NOW() 
               WHERE id = $2`,
              [dto.owner_id, owner.id]
            );
            console.log(`✅ Updated user ${owner.id} with firebase_uid`);
          }
        } else {
          // User doesn't exist - this is a problem!
          // Try to find by UUID if owner_id is a UUID
          const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.owner_id);
          
          if (isUUID) {
            const uuidResult = await client.query(
              `SELECT id, name, email, firebase_uid FROM user_profiles WHERE id = $1::uuid LIMIT 1`,
              [dto.owner_id]
            );
            
            if (uuidResult.rows.length > 0) {
              ownerExists = true;
              const owner = uuidResult.rows[0];
              ownerName = owner.name || 'ללא שם';
              console.log(`✅ Found user by UUID: ${owner.id}`);
            }
          }
          
          if (!ownerExists) {
            // User doesn't exist at all - this is critical!
            // We can't create a user without email/name, so we'll log a warning
            // and continue, but the JOIN won't work
            console.error(`❌ CRITICAL: User with firebase_uid ${dto.owner_id} does not exist in user_profiles!`);
            console.error(`   This will cause owner_name to be NULL in item listings.`);
            console.error(`   User must be registered/created before creating items.`);
          }
        }
      } catch (ownerError) {
        console.error('❌ Error checking/updating owner:', ownerError);
        // Continue anyway - we'll create the item but the JOIN won't work
      }
      
      console.log('📝 Creating item:', dto.id, dto.title, '- Owner:', ownerName, `(${dto.owner_id})`, ownerExists ? '✅' : '❌ NOT IN DB');
      
      const result = await client.query(
        `INSERT INTO items (
          id, owner_id, title, description, category, condition,
          city, address, coordinates, price, image_base64, rating,
          tags, quantity, delivery_method, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
        RETURNING *`,
        [
          dto.id,
          dto.owner_id,
          dto.title,
          dto.description || '',
          dto.category,
          dto.condition || 'used',
          dto.city || '',
          dto.address || '',
          dto.coordinates || '',
          dto.price || 0,
          dto.image_base64 || null,
          dto.rating || 0,
          dto.tags || '',
          dto.quantity || 1,
          dto.delivery_method || 'pickup',
          dto.status || 'available',
        ]
      );
      
      await client.query('COMMIT');
      
      console.log('✅ Item created successfully:', result.rows[0].id, '- Owner:', ownerName, `(${dto.owner_id})`, ownerExists ? '✅' : '❌ NOT IN DB');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); // Ignore rollback errors
      console.error('❌ Error creating item:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all items for a specific owner (not deleted)
   */
  async getItemsByOwner(ownerId: string) {
    const client = await this.pool.connect();
    try {
      console.log('🔍 Fetching items for owner:', ownerId);
      
      const result = await client.query(
        `SELECT * FROM items 
         WHERE owner_id = $1 AND is_deleted = FALSE 
         ORDER BY created_at DESC`,
        [ownerId]
      );
      
      console.log(`✅ Found ${result.rows.length} items for owner:`, ownerId);
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching items by owner:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get a single item by ID (not deleted)
   */
  async getItemById(id: string) {
    const client = await this.pool.connect();
    try {
      console.log('🔍 Fetching item:', id);
      
      const result = await client.query(
        `SELECT * FROM items WHERE id = $1 AND is_deleted = FALSE`,
        [id]
      );
      
      if (result.rows.length === 0) {
        console.log('⚠️ Item not found:', id);
        return null;
      }
      
      console.log('✅ Item found:', id);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error fetching item by ID:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update an item
   */
  async updateItem(id: string, dto: UpdateItemDto) {
    const client = await this.pool.connect();
    try {
      console.log('✏️ Updating item:', id);
      
      const fields = [];
      const values = [];
      let paramCount = 1;

      // Dynamically build UPDATE query based on provided fields
      Object.entries(dto).forEach(([key, value]) => {
        if (value !== undefined) {
          fields.push(`${key} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      });

      if (fields.length === 0) {
        console.log('⚠️ No fields to update');
        return this.getItemById(id);
      }

      fields.push(`updated_at = NOW()`);
      values.push(id);

      const query = `UPDATE items SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
      const result = await client.query(query, values);
      
      if (result.rows.length === 0) {
        console.log('⚠️ Item not found for update:', id);
        return null;
      }
      
      console.log('✅ Item updated successfully:', id);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error updating item:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Soft delete an item (set is_deleted = true)
   */
  async softDeleteItem(id: string) {
    const client = await this.pool.connect();
    try {
      console.log('🗑️ Soft deleting item:', id);
      
      const result = await client.query(
        `UPDATE items 
         SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW() 
         WHERE id = $1 AND is_deleted = FALSE
         RETURNING *`,
        [id]
      );
      
      if (result.rows.length === 0) {
        console.log('⚠️ Item not found or already deleted:', id);
        return { success: false, message: 'Item not found or already deleted' };
      }
      
      console.log('✅ Item soft deleted successfully:', id);
      return { success: true, message: 'Item deleted', item: result.rows[0] };
    } catch (error) {
      console.error('❌ Error soft deleting item:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all items by category (not deleted)
   */
  async getItemsByCategory(category: string) {
    const client = await this.pool.connect();
    try {
      console.log('🔍 Fetching items by category:', category);
      
      const result = await client.query(
        `SELECT * FROM items 
         WHERE category = $1 AND is_deleted = FALSE 
         ORDER BY created_at DESC`,
        [category]
      );
      
      console.log(`✅ Found ${result.rows.length} items for category:`, category);
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching items by category:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Search items by title or description
   */
  async searchItems(searchTerm: string) {
    const client = await this.pool.connect();
    try {
      console.log('🔍 Searching items:', searchTerm);
      
      const result = await client.query(
        `SELECT * FROM items 
         WHERE (title ILIKE $1 OR description ILIKE $1) 
         AND is_deleted = FALSE 
         ORDER BY created_at DESC`,
        [`%${searchTerm}%`]
      );
      
      console.log(`✅ Found ${result.rows.length} items matching:`, searchTerm);
      return result.rows;
    } catch (error) {
      console.error('❌ Error searching items:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}





