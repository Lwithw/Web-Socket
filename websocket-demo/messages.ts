// Message operations: search, star, pin, read receipts
import { db } from './db';

export interface Message {
  id: number;
  senderId: string;
  username: string;
  content: string;
  roomName?: string;
  messageType: 'text' | 'image' | 'video' | 'document' | 'voice' | 'sticker' | 'gif';
  recipientId?: string;
  groupId?: string;
  mediaUrl?: string;
  mediaType?: string;
  mediaSize?: number;
  mediaThumbnail?: string;
  mediaDuration?: number;
  encrypted: boolean;
  encryptionMetadata?: any;
  delivered: boolean;
  seen: boolean;
  seenAt?: Date;
  starred: boolean;
  pinned: boolean;
  replyTo?: number;
  edited: boolean;
  deleted: boolean;
  createdAt: Date;
  editedAt?: Date;
  deletedAt?: Date;
}

export class MessageManager {
  // Save message
  async saveMessage(message: Partial<Message>): Promise<Message> {
    try {
      const result = await db.query(
        `INSERT INTO messages (
          sender_id, username, content, room_name, message_type, recipient_id, group_id,
          media_url, media_type, media_size, media_thumbnail, media_duration,
          encrypted, encryption_metadata, delivered, reply_to
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *`,
        [
          message.senderId,
          message.username,
          message.content,
          message.roomName || null,
          message.messageType || 'text',
          message.recipientId || null,
          message.groupId || null,
          message.mediaUrl || null,
          message.mediaType || null,
          message.mediaSize || null,
          message.mediaThumbnail || null,
          message.mediaDuration || null,
          message.encrypted || false,
          message.encryptionMetadata ? JSON.stringify(message.encryptionMetadata) : null,
          message.messageType === 'text' && !message.recipientId ? true : false,
          message.replyTo || null
        ]
      );

      return this.mapMessage(result.rows[0]);
    } catch (error) {
      console.error('Error saving message:', error);
      throw error;
    }
  }

  // Get messages with filters
  async getMessages(filters: {
    roomName?: string;
    recipientId?: string;
    groupId?: string;
    senderId?: string;
    limit?: number;
    offset?: number;
    starred?: boolean;
    pinned?: boolean;
  }): Promise<Message[]> {
    try {
      let query = 'SELECT * FROM messages WHERE deleted = false';
      const params: any[] = [];
      let paramIndex = 1;

      if (filters.roomName) {
        query += ` AND room_name = $${paramIndex++}`;
        params.push(filters.roomName);
      }

      if (filters.recipientId) {
        query += ` AND recipient_id = $${paramIndex++}`;
        params.push(filters.recipientId);
      }

      if (filters.groupId) {
        query += ` AND group_id = $${paramIndex++}`;
        params.push(filters.groupId);
      }

      if (filters.senderId) {
        query += ` AND sender_id = $${paramIndex++}`;
        params.push(filters.senderId);
      }

      if (filters.starred !== undefined) {
        query += ` AND starred = $${paramIndex++}`;
        params.push(filters.starred);
      }

      if (filters.pinned !== undefined) {
        query += ` AND pinned = $${paramIndex++}`;
        params.push(filters.pinned);
      }

      query += ' ORDER BY created_at DESC';

      if (filters.limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(filters.limit);
      }

      if (filters.offset) {
        query += ` OFFSET $${paramIndex++}`;
        params.push(filters.offset);
      }

      const result = await db.query(query, params);
      return result.rows.map((row: Record<string, any>) => this.mapMessage(row));
    } catch (error) {
      console.error('Error getting messages:', error);
      return [];
    }
  }

  // Search messages
  async searchMessages(userId: string, searchTerm: string, filters?: {
    roomName?: string;
    messageType?: string;
    limit?: number;
  }): Promise<Message[]> {
    try {
      let query = `
        SELECT * FROM messages 
        WHERE deleted = false 
        AND (sender_id = $1 OR recipient_id = $1 OR room_name IN (
          SELECT room_name FROM messages WHERE sender_id = $1 OR recipient_id = $1
        ))
        AND to_tsvector('english', content) @@ plainto_tsquery('english', $2)
      `;
      const params: any[] = [userId, searchTerm];
      let paramIndex = 3;

      if (filters?.roomName) {
        query += ` AND room_name = $${paramIndex++}`;
        params.push(filters.roomName);
      }

      if (filters?.messageType) {
        query += ` AND message_type = $${paramIndex++}`;
        params.push(filters.messageType);
      }

      query += ' ORDER BY created_at DESC';

      if (filters?.limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(filters.limit);
      }

      const result = await db.query(query, params);
      return result.rows.map((row: Record<string, any>) => this.mapMessage(row));
    } catch (error) {
      console.error('Error searching messages:', error);
      return [];
    }
  }

  // Star/unstar message
  async toggleStar(messageId: number, userId: string): Promise<boolean> {
    try {
      const result = await db.query(
        'UPDATE messages SET starred = NOT starred WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2) RETURNING starred',
        [messageId, userId]
      );

      if (result.rows.length === 0) return false;
      console.log(`✅ Message ${messageId} starred: ${result.rows[0].starred}`);
      return result.rows[0].starred;
    } catch (error) {
      console.error('Error toggling star:', error);
      return false;
    }
  }

  // Pin/unpin message
  async togglePin(messageId: number, roomName: string): Promise<boolean> {
    try {
      const result = await db.query(
        'UPDATE messages SET pinned = NOT pinned WHERE id = $1 AND room_name = $2 RETURNING pinned',
        [messageId, roomName]
      );

      if (result.rows.length === 0) return false;
      console.log(`✅ Message ${messageId} pinned: ${result.rows[0].pinned}`);
      return result.rows[0].pinned;
    } catch (error) {
      console.error('Error toggling pin:', error);
      return false;
    }
  }

  // Mark message as delivered
  async markDelivered(messageId: number): Promise<void> {
    try {
      await db.query(
        'UPDATE messages SET delivered = true WHERE id = $1',
        [messageId]
      );
    } catch (error) {
      console.error('Error marking delivered:', error);
    }
  }

  // Mark message as seen
  async markSeen(messageId: number, userId: string): Promise<void> {
    try {
      await db.query(
        'UPDATE messages SET seen = true, seen_at = CURRENT_TIMESTAMP WHERE id = $1',
        [messageId]
      );

      // Add read receipt
      await db.query(
        'INSERT INTO read_receipts (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [messageId, userId]
      );

      console.log(`✅ Message ${messageId} marked as seen by ${userId}`);
    } catch (error) {
      console.error('Error marking seen:', error);
    }
  }

  // Get read receipts for a message
  async getReadReceipts(messageId: number): Promise<Array<{ userId: string; readAt: Date }>> {
    try {
      const result = await db.query(
        'SELECT user_id, read_at FROM read_receipts WHERE message_id = $1',
        [messageId]
      );

      return result.rows.map((row: Record<string, any>) => ({
        userId: row.user_id,
        readAt: row.read_at
      }));
    } catch (error) {
      console.error('Error getting read receipts:', error);
      return [];
    }
  }

  // Edit message
  async editMessage(messageId: number, userId: string, newContent: string): Promise<boolean> {
    try {
      const result = await db.query(
        'UPDATE messages SET content = $1, edited = true, edited_at = CURRENT_TIMESTAMP WHERE id = $2 AND sender_id = $3 RETURNING id',
        [newContent, messageId, userId]
      );

      if (result.rows.length === 0) return false;
      console.log(`✅ Message ${messageId} edited`);
      return true;
    } catch (error) {
      console.error('Error editing message:', error);
      return false;
    }
  }

  // Delete message
  async deleteMessage(messageId: number, userId: string): Promise<boolean> {
    try {
      const result = await db.query(
        'UPDATE messages SET deleted = true, deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND sender_id = $2 RETURNING id',
        [messageId, userId]
      );

      if (result.rows.length === 0) return false;
      console.log(`✅ Message ${messageId} deleted`);
      return true;
    } catch (error) {
      console.error('Error deleting message:', error);
      return false;
    }
  }

  // Get unread count
  async getUnreadCount(userId: string, roomName?: string): Promise<number> {
    try {
      let query = 'SELECT COUNT(*) FROM messages WHERE recipient_id = $1 AND seen = false AND deleted = false';
      const params: any[] = [userId];

      if (roomName) {
        query += ' AND room_name = $2';
        params.push(roomName);
      }

      const result = await db.query(query, params);
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error('Error getting unread count:', error);
      return 0;
    }
  }

  // Get conversation between two users
  async getConversation(user1Id: string, user2Id: string, limit: number = 50): Promise<Message[]> {
    try {
      const result = await db.query(
        `SELECT * FROM messages 
         WHERE deleted = false 
         AND ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
         ORDER BY created_at DESC 
         LIMIT $3`,
        [user1Id, user2Id, limit]
      );

      return result.rows.map((row: Record<string, any>) => this.mapMessage(row)).reverse();
    } catch (error) {
      console.error('Error getting conversation:', error);
      return [];
    }
  }

  // Helper to map DB row to Message
  private mapMessage(row: Record<string, any>): Message {
    return {
      id: row.id,
      senderId: row.sender_id,
      username: row.username,
      content: row.content,
      roomName: row.room_name,
      messageType: row.message_type,
      recipientId: row.recipient_id,
      groupId: row.group_id,
      mediaUrl: row.media_url,
      mediaType: row.media_type,
      mediaSize: row.media_size,
      mediaThumbnail: row.media_thumbnail,
      mediaDuration: row.media_duration,
      encrypted: row.encrypted,
      encryptionMetadata: row.encryption_metadata,
      delivered: row.delivered,
      seen: row.seen,
      seenAt: row.seen_at,
      starred: row.starred,
      pinned: row.pinned,
      replyTo: row.reply_to,
      edited: row.edited,
      deleted: row.deleted,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deletedAt: row.deleted_at
    };
  }
}

export const messageManager = new MessageManager();
