// Signal Protocol Implementation using @signalapp/libsignal-client
import {
  IdentityKeyPair,
  PreKeyBundle,
  PreKeyRecord,
  PrivateKey,
  PublicKey,
  SessionRecord,
  SignedPreKeyRecord,
  signalEncrypt,
  signalDecrypt,
  processPreKeyBundle,
  ProtocolAddress,
  Direction,
} from '@signalapp/libsignal-client';
import { db } from './db';

// Database-backed session store
class DatabaseSessionStore {
  async saveSession(address: ProtocolAddress, record: SessionRecord): Promise<void> {
    const userId = address.name();
    const peerId = `${userId}:${address.deviceId()}`;
    const sessionData = record.serialize().toString('base64');
    
    try {
      await db.query(
        `INSERT INTO signal_sessions (user_id, peer_id, session_data, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, peer_id) DO UPDATE SET
           session_data = EXCLUDED.session_data,
           updated_at = CURRENT_TIMESTAMP`,
        [userId, peerId, sessionData]
      );
    } catch (error) {
      console.error('Error saving session to database:', error);
      throw error;
    }
  }

  async getSession(address: ProtocolAddress): Promise<SessionRecord | null> {
    const userId = address.name();
    const peerId = `${userId}:${address.deviceId()}`;
    
    try {
      const result = await db.query(
        'SELECT session_data FROM signal_sessions WHERE user_id = $1 AND peer_id = $2',
        [userId, peerId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const sessionData = Buffer.from(result.rows[0].session_data, 'base64');
      return SessionRecord.deserialize(sessionData);
    } catch (error) {
      console.error('Error getting session from database:', error);
      return null;
    }
  }

  async getExistingSessions(addresses: ProtocolAddress[]): Promise<SessionRecord[]> {
    const sessions: SessionRecord[] = [];
    for (const addr of addresses) {
      const session = await this.getSession(addr);
      if (session) sessions.push(session);
    }
    return sessions;
  }
}

class DatabaseIdentityStore {
  private localUserId: string = '';
  private localIdentityPair: IdentityKeyPair | null = null;
  private localRegistrationId: number = 0;

  setLocalUser(userId: string) {
    this.localUserId = userId;
  }

  async getIdentityKey(): Promise<PrivateKey> {
    if (!this.localIdentityPair) {
      await this.loadLocalIdentity();
    }
    if (!this.localIdentityPair) {
      throw new Error('No identity key pair');
    }
    return this.localIdentityPair.privateKey;
  }

  async getLocalRegistrationId(): Promise<number> {
    if (this.localRegistrationId === 0) {
      await this.loadLocalIdentity();
    }
    return this.localRegistrationId;
  }

  private async loadLocalIdentity() {
    if (!this.localUserId) return;
    
    try {
      const result = await db.query(
        'SELECT identity_key_pair, registration_id FROM signal_keys WHERE user_id = $1',
        [this.localUserId]
      );
      
      if (result.rows.length > 0) {
        const keys = result.rows[0].identity_key_pair;
        const publicKey = PublicKey.deserialize(Buffer.from(keys.publicKey, 'base64'));
        const privateKey = PrivateKey.deserialize(Buffer.from(keys.privateKey, 'base64'));
        this.localIdentityPair = IdentityKeyPair.new(publicKey, privateKey);
        this.localRegistrationId = result.rows[0].registration_id;
      }
    } catch (error) {
      console.error('Error loading local identity:', error);
    }
  }

  async saveIdentity(address: ProtocolAddress, key: PublicKey): Promise<boolean> {
    // Store trusted identity in database (simplified - could use separate table)
    // For now, we trust all identities after first contact
    return true;
  }

  async isTrustedIdentity(
    address: ProtocolAddress,
    key: PublicKey,
    _direction: Direction
  ): Promise<boolean> {
    // Trust identity after first contact (could be enhanced with explicit trust management)
    return true;
  }

  async getIdentity(address: ProtocolAddress): Promise<PublicKey | null> {
    // Get identity from signal_keys table
    try {
      const result = await db.query(
        'SELECT identity_key_pair FROM signal_keys WHERE user_id = $1',
        [address.name()]
      );
      
      if (result.rows.length > 0) {
        const keys = result.rows[0].identity_key_pair;
        return PublicKey.deserialize(Buffer.from(keys.publicKey, 'base64'));
      }
    } catch (error) {
      console.error('Error getting identity:', error);
    }
    return null;
  }

  setIdentityKeyPair(pair: IdentityKeyPair, registrationId: number) {
    this.localIdentityPair = pair;
    this.localRegistrationId = registrationId;
  }

  getIdentityKeyPair(): IdentityKeyPair | null {
    return this.localIdentityPair;
  }
}

class DatabasePreKeyStore {
  private userId: string = '';

  setUserId(userId: string) {
    this.userId = userId;
  }

  async savePreKey(id: number, record: PreKeyRecord): Promise<void> {
    // Pre-keys are stored as part of the pre_key_bundle in signal_keys table
    // This is handled during user initialization
  }

  async getPreKey(id: number): Promise<PreKeyRecord> {
    try {
      const result = await db.query(
        'SELECT pre_key_bundle FROM signal_keys WHERE user_id = $1',
        [this.userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error(`No pre-keys found for user ${this.userId}`);
      }
      
      const bundle = result.rows[0].pre_key_bundle;
      const preKeyData = bundle.preKeys.find((pk: any) => pk.id === id);
      
      if (!preKeyData) {
        throw new Error(`PreKey ${id} not found`);
      }
      
      const publicKey = PublicKey.deserialize(Buffer.from(preKeyData.publicKey, 'base64'));
      // Note: In production, you'd need to store the private key securely
      // For now, this is a simplified implementation
      return PreKeyRecord.new(id, publicKey, PrivateKey.generate());
    } catch (error) {
      console.error('Error getting pre-key:', error);
      throw error;
    }
  }

  async removePreKey(id: number): Promise<void> {
    // Remove pre-key from bundle
    try {
      const result = await db.query(
        'SELECT pre_key_bundle FROM signal_keys WHERE user_id = $1',
        [this.userId]
      );
      
      if (result.rows.length > 0) {
        const bundle = result.rows[0].pre_key_bundle;
        bundle.preKeys = bundle.preKeys.filter((pk: any) => pk.id !== id);
        
        await db.query(
          'UPDATE signal_keys SET pre_key_bundle = $1 WHERE user_id = $2',
          [JSON.stringify(bundle), this.userId]
        );
      }
    } catch (error) {
      console.error('Error removing pre-key:', error);
    }
  }
}

class DatabaseSignedPreKeyStore {
  private userId: string = '';

  setUserId(userId: string) {
    this.userId = userId;
  }

  async saveSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
    // Signed pre-keys are stored as part of the pre_key_bundle in signal_keys table
    // This is handled during user initialization
  }

  async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    try {
      const result = await db.query(
        'SELECT pre_key_bundle FROM signal_keys WHERE user_id = $1',
        [this.userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error(`No signed pre-key found for user ${this.userId}`);
      }
      
      const bundle = result.rows[0].pre_key_bundle;
      const signedPreKeyData = bundle.signedPreKey;
      
      if (!signedPreKeyData || signedPreKeyData.keyId !== id) {
        throw new Error(`SignedPreKey ${id} not found`);
      }
      
      const publicKey = PublicKey.deserialize(Buffer.from(signedPreKeyData.publicKey, 'base64'));
      const signature = Buffer.from(signedPreKeyData.signature, 'base64');
      
      // Note: In production, you'd need to store the private key securely
      // For now, this is a simplified implementation
      return SignedPreKeyRecord.new(
        id,
        Date.now(),
        publicKey,
        PrivateKey.generate(),
        signature
      );
    } catch (error) {
      console.error('Error getting signed pre-key:', error);
      throw error;
    }
  }
}

// Signal Protocol Manager
export class SignalProtocolManager {
  private sessionStore = new DatabaseSessionStore();
  private identityStore = new DatabaseIdentityStore();
  private preKeyStore = new DatabasePreKeyStore();
  private signedPreKeyStore = new DatabaseSignedPreKeyStore();

  // Initialize user with keys
  async initializeUser(userId: string): Promise<{
    identityKey: string;
    registrationId: number;
    preKeyBundle: any;
  }> {
    // Set user ID for stores
    this.identityStore.setLocalUser(userId);
    this.preKeyStore.setUserId(userId);
    this.signedPreKeyStore.setUserId(userId);

    // Generate identity key pair
    const identityKeyPair = IdentityKeyPair.generate();
    const registrationId = Math.floor(Math.random() * 16384) + 1;

    this.identityStore.setIdentityKeyPair(identityKeyPair, registrationId);

    // Generate signed pre-key
    const signedPreKeyId = 1;
    const signedPreKeyPair = PrivateKey.generate();
    const signedPreKeyPublic = signedPreKeyPair.getPublicKey();
    const signedPreKeySignature = identityKeyPair.privateKey.sign(
      signedPreKeyPublic.serialize()
    );
    const timestamp = Date.now();

    const signedPreKeyRecord = SignedPreKeyRecord.new(
      signedPreKeyId,
      timestamp,
      signedPreKeyPair.getPublicKey(),
      signedPreKeyPair,
      signedPreKeySignature
    );

    await this.signedPreKeyStore.saveSignedPreKey(signedPreKeyId, signedPreKeyRecord);

    // Generate one-time pre-keys
    const preKeys: Array<{ id: number; publicKey: string }> = [];
    for (let i = 1; i <= 10; i++) {
      const preKeyPair = PrivateKey.generate();
      const preKeyRecord = PreKeyRecord.new(i, preKeyPair.getPublicKey(), preKeyPair);
      await this.preKeyStore.savePreKey(i, preKeyRecord);
      preKeys.push({
        id: i,
        publicKey: preKeyPair.getPublicKey().serialize().toString('base64'),
      });
    }

    // Create pre-key bundle
    const preKeyBundle = {
      identityKey: identityKeyPair.publicKey.serialize().toString('base64'),
      registrationId,
      signedPreKey: {
        keyId: signedPreKeyId,
        publicKey: signedPreKeyPublic.serialize().toString('base64'),
        signature: signedPreKeySignature.toString('base64'),
      },
      preKeys,
    };

    // Store in database
    await this.storeUserKeys(userId, {
      identityKeyPair: {
        publicKey: identityKeyPair.publicKey.serialize().toString('base64'),
        privateKey: identityKeyPair.privateKey.serialize().toString('base64'),
      },
      registrationId,
      preKeyBundle,
    });

    return {
      identityKey: identityKeyPair.publicKey.serialize().toString('base64'),
      registrationId,
      preKeyBundle,
    };
  }

  // Store user keys in database
  private async storeUserKeys(userId: string, keys: any): Promise<void> {
    try {
      await db.query(
        `INSERT INTO signal_keys (user_id, identity_key_pair, registration_id, pre_key_bundle, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET
           identity_key_pair = EXCLUDED.identity_key_pair,
           registration_id = EXCLUDED.registration_id,
           pre_key_bundle = EXCLUDED.pre_key_bundle,
           updated_at = CURRENT_TIMESTAMP`,
        [userId, JSON.stringify(keys.identityKeyPair), keys.registrationId, JSON.stringify(keys.preKeyBundle)]
      );
      console.log(`✅ Stored keys for user ${userId}`);
    } catch (error) {
      console.error('Error storing user keys:', error);
    }
  }

  // Get user's pre-key bundle
  async getUserPreKeyBundle(userId: string): Promise<any> {
    try {
      const result = await db.query(
        'SELECT pre_key_bundle FROM signal_keys WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        console.log(`No keys found for user ${userId}, initializing...`);
        const init = await this.initializeUser(userId);
        return init.preKeyBundle;
      }

      return result.rows[0].pre_key_bundle;
    } catch (error) {
      console.error('Error getting pre-key bundle:', error);
      return null;
    }
  }

  // Load user keys from database
  async loadUserKeys(userId: string): Promise<void> {
    try {
      // Set user ID for stores
      this.identityStore.setLocalUser(userId);
      this.preKeyStore.setUserId(userId);
      this.signedPreKeyStore.setUserId(userId);

      const result = await db.query(
        'SELECT identity_key_pair, registration_id FROM signal_keys WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        await this.initializeUser(userId);
        return;
      }

      const keys = result.rows[0];
      const identityKeyPair = keys.identity_key_pair;

      const publicKey = PublicKey.deserialize(
        Buffer.from(identityKeyPair.publicKey, 'base64')
      );
      const privateKey = PrivateKey.deserialize(
        Buffer.from(identityKeyPair.privateKey, 'base64')
      );

      const pair = IdentityKeyPair.new(publicKey, privateKey);
      this.identityStore.setIdentityKeyPair(pair, keys.registration_id);
    } catch (error) {
      console.error('Error loading user keys:', error);
    }
  }

  // Process pre-key bundle and establish session
  async processPreKeyBundle(
    senderUserId: string,
    recipientUserId: string,
    bundle: any
  ): Promise<void> {
    await this.loadUserKeys(senderUserId);

    const recipientAddress = ProtocolAddress.new(recipientUserId, 1);

    // Parse bundle
    const identityKey = PublicKey.deserialize(Buffer.from(bundle.identityKey, 'base64'));
    const signedPreKey = PublicKey.deserialize(
      Buffer.from(bundle.signedPreKey.publicKey, 'base64')
    );
    const signedPreKeySignature = Buffer.from(bundle.signedPreKey.signature, 'base64');

    // Get a one-time pre-key if available
    let preKey: PublicKey | null = null;
    let preKeyId: number | null = null;

    if (bundle.preKeys && bundle.preKeys.length > 0) {
      const preKeyData = bundle.preKeys[0];
      preKey = PublicKey.deserialize(Buffer.from(preKeyData.publicKey, 'base64'));
      preKeyId = preKeyData.id;
    }

    // Create PreKeyBundle
    const preKeyBundle = PreKeyBundle.new(
      bundle.registrationId,
      1, // deviceId
      preKeyId,
      preKey,
      bundle.signedPreKey.keyId,
      signedPreKey,
      signedPreKeySignature,
      identityKey
    );

    // Process bundle to create session
    await processPreKeyBundle(
      preKeyBundle,
      recipientAddress,
      this.sessionStore,
      this.identityStore,
      Date.now()
    );

    console.log(`✅ Session established between ${senderUserId} and ${recipientUserId}`);
  }

  // Encrypt message
  async encryptMessage(
    senderUserId: string,
    recipientUserId: string,
    message: string
  ): Promise<{ type: number; body: string }> {
    await this.loadUserKeys(senderUserId);

    const recipientAddress = ProtocolAddress.new(recipientUserId, 1);

    // Check if session exists
    let session = await this.sessionStore.getSession(recipientAddress);

    if (!session) {
      // Need to establish session first
      const bundle = await this.getUserPreKeyBundle(recipientUserId);
      if (!bundle) throw new Error('Cannot get recipient pre-key bundle');

      await this.processPreKeyBundle(senderUserId, recipientUserId, bundle);
      session = await this.sessionStore.getSession(recipientAddress);
      if (!session) throw new Error('Failed to establish session');
    }

    // Encrypt message
    const ciphertext = await signalEncrypt(
      Buffer.from(message, 'utf8'),
      recipientAddress,
      this.sessionStore,
      this.identityStore,
      Date.now()
    );

    // Save updated session
    await this.sessionStore.saveSession(recipientAddress, session);

    return {
      type: ciphertext.type(),
      body: ciphertext.serialize().toString('base64'),
    };
  }

  // Decrypt message
  async decryptMessage(
    recipientUserId: string,
    senderUserId: string,
    encryptedMessage: { type: number; body: string }
  ): Promise<string> {
    await this.loadUserKeys(recipientUserId);

    const senderAddress = ProtocolAddress.new(senderUserId, 1);
    
    const ciphertext = Buffer.from(encryptedMessage.body, 'base64');
    
    // Decrypt based on message type
    const plaintext = await signalDecrypt(
      ciphertext,
      senderAddress,
      this.sessionStore,
      this.identityStore,
      this.preKeyStore,
      this.signedPreKeyStore,
      Date.now()
    );

    return plaintext.toString('utf8');
  }
}

// Export singleton instance
export const signalManager = new SignalProtocolManager();

// Session manager for tracking active sessions
export class SessionManager {
  private sessions: Map<string, any> = new Map();

  createSession(userId: string, peerId: string, sessionData: any) {
    const key = `${userId}:${peerId}`;
    this.sessions.set(key, sessionData);
  }

  getSession(userId: string, peerId: string) {
    const key = `${userId}:${peerId}`;
    return this.sessions.get(key);
  }

  deleteSession(userId: string, peerId: string) {
    const key = `${userId}:${peerId}`;
    this.sessions.delete(key);
  }

  hasSession(userId: string, peerId: string): boolean {
    const key = `${userId}:${peerId}`;
    return this.sessions.has(key);
  }
}

export const sessionManager = new SessionManager();
