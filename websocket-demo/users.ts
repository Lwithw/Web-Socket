// User management: blocking, reporting, presence
import { db } from './db';

export interface User {
  id: string;
  username: string;
  identityKey: string;
  signedPrekey: string;
  prekeySignature: string;
  oneTimePrekeys: string[];
  registrationId: number;
  profilePicture?: string;
  status: 'online' | 'offline' | 'away';
  lastSeen: Date;
}

export class UserManager {
  // Create or update user
  async upsertUser(user: Partial<User>): Promise<User> {
    try {
      const result = await db.query(
        `INSERT INTO users (id, username, identity_key, signed_prekey, prekey_signature, one_time_prekeys, registration_id, profile_picture, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           username = EXCLUDED.username,
           identity_key = EXCLUDED.identity_key,
           signed_prekey = EXCLUDED.signed_prekey,
           prekey_signature = EXCLUDED.prekey_signature,
           one_time_prekeys = EXCLUDED.one_time_prekeys,
           profile_picture = EXCLUDED.profile_picture,
           status = EXCLUDED.status,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [
          user.id,
          user.username,
          user.identityKey || '',
          user.signedPrekey || '',
          user.prekeySignature || '',
          user.oneTimePrekeys || [],
          user.registrationId || 0,
          user.profilePicture || null,
          user.status || 'online'
        ]
      );

      return this.mapUser(result.rows[0]);
    } catch (error) {
      console.error('Error upserting user:', error);
      throw error;
    }
  }

  // Get user by ID
  async getUser(userId: string): Promise<User | null> {
    try {
      const result = await db.query(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );

      if (result.rows.length === 0) return null;
      return this.mapUser(result.rows[0]);
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  // Get user by username
  async getUserByUsername(username: string): Promise<User | null> {
    try {
      const result = await db.query(
        'SELECT * FROM users WHERE username = $1',
        [username]
      );

      if (result.rows.length === 0) return null;
      return this.mapUser(result.rows[0]);
    } catch (error) {
      console.error('Error getting user by username:', error);
      return null;
    }
  }

  // Update user status
  async updateStatus(userId: string, status: User['status']): Promise<void> {
    try {
      await db.query(
        'UPDATE users SET status = $1, last_seen = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [status, userId]
      );
    } catch (error) {
      console.error('Error updating user status:', error);
    }
  }

  // Block user
  async blockUser(blockerId: string, blockedId: string, reason?: string): Promise<boolean> {
    try {
      await db.query(
        'INSERT INTO blocked_users (blocker_id, blocked_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [blockerId, blockedId, reason || null]
      );
      console.log(`✅ User ${blockerId} blocked ${blockedId}`);
      return true;
    } catch (error) {
      console.error('Error blocking user:', error);
      return false;
    }
  }

  // Unblock user
  async unblockUser(blockerId: string, blockedId: string): Promise<boolean> {
    try {
      await db.query(
        'DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2',
        [blockerId, blockedId]
      );
      console.log(`✅ User ${blockerId} unblocked ${blockedId}`);
      return true;
    } catch (error) {
      console.error('Error unblocking user:', error);
      return false;
    }
  }

  // Check if user is blocked
  async isBlocked(userId: string, targetId: string): Promise<boolean> {
    try {
      const result = await db.query(
        'SELECT 1 FROM blocked_users WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)',
        [userId, targetId]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error('Error checking block status:', error);
      return false;
    }
  }

  // Get blocked users
  async getBlockedUsers(userId: string): Promise<string[]> {
    try {
      const result = await db.query(
        'SELECT blocked_id FROM blocked_users WHERE blocker_id = $1',
        [userId]
      );
      return result.rows.map((row: Record<string, any>) => row.blocked_id);
    } catch (error) {
      console.error('Error getting blocked users:', error);
      return [];
    }
  }

  // Report user
  async reportUser(reporterId: string, reportedId: string, reason: string, messageId?: number): Promise<boolean> {
    try {
      await db.query(
        'INSERT INTO user_reports (reporter_id, reported_id, reason, message_id) VALUES ($1, $2, $3, $4)',
        [reporterId, reportedId, reason, messageId || null]
      );
      console.log(`✅ User ${reporterId} reported ${reportedId}: ${reason}`);
      return true;
    } catch (error) {
      console.error('Error reporting user:', error);
      return false;
    }
  }

  // Get user's pre-key bundle (for Signal Protocol)
  async getPreKeyBundle(userId: string) {
    try {
      const result = await db.query(
        'SELECT identity_key, signed_prekey, prekey_signature, one_time_prekeys, registration_id FROM users WHERE id = $1',
        [userId]
      );

      if (result.rows.length === 0) return null;

      const user = result.rows[0];
      const oneTimePrekey = user.one_time_prekeys && user.one_time_prekeys.length > 0
        ? user.one_time_prekeys[0]
        : null;

      // Remove used one-time prekey
      if (oneTimePrekey) {
        await db.query(
          'UPDATE users SET one_time_prekeys = array_remove(one_time_prekeys, $1) WHERE id = $2',
          [oneTimePrekey, userId]
        );
      }

      return {
        identityKey: user.identity_key,
        signedPreKey: user.signed_prekey,
        preKeySignature: user.prekey_signature,
        oneTimePreKey: oneTimePrekey,
        registrationId: user.registration_id
      };
    } catch (error) {
      console.error('Error getting pre-key bundle:', error);
      return null;
    }
  }

  // Helper to map DB row to User
  private mapUser(row: Record<string, any>): User {
    return {
      id: row.id,
      username: row.username,
      identityKey: row.identity_key,
      signedPrekey: row.signed_prekey,
      prekeySignature: row.prekey_signature,
      oneTimePrekeys: row.one_time_prekeys || [],
      registrationId: row.registration_id,
      profilePicture: row.profile_picture,
      status: row.status,
      lastSeen: row.last_seen
    };
  }
}

export const userManager = new UserManager();
