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
      console.log('📝 Creating item:', dto.id, dto.title);
      
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
      
      console.log('✅ Item created successfully:', result.rows[0].id);
      return result.rows[0];
    } catch (error) {
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




