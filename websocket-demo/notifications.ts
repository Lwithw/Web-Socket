// notifications.ts - Push Notification Service
import { db } from './db';

export interface Notification {
  id: number;
  userId: string;
  type: 'message' | 'mention' | 'reaction' | 'system';
  title: string;
  body?: string;
  data?: any;
  read: boolean;
  createdAt: Date;
}

class NotificationService {
  // Create notification
  async createNotification(
    userId: string,
    type: string,
    title: string,
    body?: string,
    data?: any
  ): Promise<Notification> {
    try {
      const result = await db.query(
        `INSERT INTO notifications (user_id, type, title, body, data, created_at) 
         VALUES ($1, $2, $3, $4, $5, NOW()) 
         RETURNING id, user_id, type, title, body, data, read, created_at`,
        [userId, type, title, body || null, data ? JSON.stringify(data) : null]
      );

      console.log(`🔔 Notification created for ${userId}: ${title}`);
      return {
        id: result.rows[0].id,
        userId: result.rows[0].user_id,
        type: result.rows[0].type,
        title: result.rows[0].title,
        body: result.rows[0].body,
        data: result.rows[0].data,
        read: result.rows[0].read,
        createdAt: result.rows[0].created_at
      };
    } catch (error) {
      console.error('❌ Failed to create notification:', error);
      throw error;
    }
  }

  // Get user notifications
  async getUserNotifications(userId: string, limit: number = 50): Promise<Notification[]> {
    try {
      const result = await db.query(
        `SELECT id, user_id, type, title, body, data, read, created_at 
         FROM notifications 
         WHERE user_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        type: row.type,
        title: row.title,
        body: row.body,
        data: row.data,
        read: row.read,
        createdAt: row.created_at
      }));
    } catch (error) {
      console.error('❌ Failed to get notifications:', error);
      return [];
    }
  }

  // Mark notification as read
  async markAsRead(notificationId: number, userId: string): Promise<boolean> {
    try {
      const result = await db.query(
        'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
        [notificationId, userId]
      );

      return result.rowCount ? result.rowCount > 0 : false;
    } catch (error) {
      console.error('❌ Failed to mark notification as read:', error);
      return false;
    }
  }

  // Mark all notifications as read
  async markAllAsRead(userId: string): Promise<boolean> {
    try {
      await db.query(
        'UPDATE notifications SET read = true WHERE user_id = $1 AND read = false',
        [userId]
      );

      console.log(`✅ All notifications marked as read for ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to mark all as read:', error);
      return false;
    }
  }

  // Get unread count
  async getUnreadCount(userId: string): Promise<number> {
    try {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false',
        [userId]
      );

      return parseInt(result.rows[0].count) || 0;
    } catch (error) {
      console.error('❌ Failed to get unread count:', error);
      return 0;
    }
  }

  // Delete notification
  async deleteNotification(notificationId: number, userId: string): Promise<boolean> {
    try {
      const result = await db.query(
        'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
        [notificationId, userId]
      );

      return result.rowCount ? result.rowCount > 0 : false;
    } catch (error) {
      console.error('❌ Failed to delete notification:', error);
      return false;
    }
  }

  // Send message notification
  async notifyNewMessage(recipientId: string, senderUsername: string, preview: string) {
    return this.createNotification(
      recipientId,
      'message',
      `New message from ${senderUsername}`,
      preview.substring(0, 100),
      { sender: senderUsername }
    );
  }

  // Send mention notification
  async notifyMention(userId: string, mentionedBy: string, roomName: string) {
    return this.createNotification(
      userId,
      'mention',
      `${mentionedBy} mentioned you`,
      `In ${roomName}`,
      { mentionedBy, roomName }
    );
  }
}

export const notificationService = new NotificationService();
