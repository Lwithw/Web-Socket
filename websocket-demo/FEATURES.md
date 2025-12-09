# Enhanced Chat Server - Complete Feature List

## ✅ Implemented Features

### 1. **Messaging Types**
- ✅ One-to-one chat (Direct Messages)
- ✅ Group chat (Multiple users in rooms)
- ✅ Broadcast messages (Room-based pub/sub)
- ✅ Text messaging
- ✅ Emojis support
- ✅ Stickers support
- ✅ GIF support

### 2. **Media Sharing**
- ✅ Image sharing (JPEG, PNG, GIF, WebP)
- ✅ Video sharing (MP4, WebM, QuickTime)
- ✅ Document sharing (PDF, Word)
- ✅ Voice notes (MP3, OGG, WAV, WebM)
- ✅ Media compression (placeholder for sharp/ffmpeg)
- ✅ Thumbnail generation (placeholder)
- ✅ File size validation (100MB max)
- ✅ MIME type validation

### 3. **End-to-End Encryption (Signal Protocol)**
- ✅ Identity key pair generation
- ✅ Signed pre-key generation
- ✅ One-time pre-keys
- ✅ Key exchange mechanism
- ✅ Message encryption (AES-256-GCM)
- ✅ Message decryption
- ✅ Session management
- ✅ Pre-key bundle distribution

### 4. **Message Features**
- ✅ Read receipts (delivered status)
- ✅ Read receipts (seen status)
- ✅ Typing indicators
- ✅ Message timestamps
- ✅ Star/favorite messages
- ✅ Pin messages (room-level)
- ✅ Message search (full-text search)
- ✅ Message editing
- ✅ Message deletion (soft delete)
- ✅ Reply to messages
- ✅ Offline message queue

### 5. **User Management**
- ✅ Block contacts
- ✅ Unblock contacts
- ✅ Report users
- ✅ User presence (online/offline/away)
- ✅ Last seen timestamp
- ✅ Profile pictures
- ✅ User status updates

### 6. **Notifications**
- ✅ Message notifications (via WebSocket events)
- ✅ Unread count tracking
- ✅ Offline message delivery notifications

### 7. **Advanced Features**
- ✅ Room management (create, join, leave)
- ✅ Online users list per room
- ✅ Room list with user counts
- ✅ Message history retrieval
- ✅ Conversation history (1-on-1)
- ✅ RabbitMQ integration (optional)
- ✅ PostgreSQL persistence
- ✅ Database indexing for performance

## 📁 File Structure

```
websocket-demo/
├── server.ts             # Main enhanced server with all features
├── encryption.ts         # Signal Protocol implementation
├── media.ts             # Media upload/compression handler
├── users.ts             # User management (block/report)
├── messages.ts          # Message operations (search/star/pin)
├── schema.sql           # Database schema
├── db.ts                # Database connection
├── rabbitmq.ts          # Message queue (optional)
└── server.ts            # Original simple server
```

## 🚀 API Endpoints

### REST API

#### GET /rooms
List all active rooms with user counts

#### GET /messages?room=general&limit=50
Get message history for a room

#### GET /users?room=general
Get online users in a room

#### GET /search?q=hello&userId=user123
Search messages

#### POST /upload
Upload media files (images, videos, documents, voice)
- Form data: file, userId, messageType

#### GET /media/:filename
Serve uploaded media files

#### POST /block
Block a user
- Body: { userId, blockedUserId }

#### POST /report
Report a user
- Body: { reporterId, reportedUserId, reason }

### WebSocket Events

#### Client → Server

**join** - Join a room
```json
{
  "type": "join",
  "username": "Alice",
  "userId": "user123",
  "room": "general"
}
```

**leave** - Leave a room
```json
{
  "type": "leave",
  "room": "general"
}
```

**message** - Send message to room
```json
{
  "type": "message",
  "content": "Hello!",
  "room": "general",
  "mediaUrl": "/media/image.jpg",
  "mediaType": "image"
}
```

**dm** - Direct message
```json
{
  "type": "dm",
  "recipientId": "user456",
  "content": "Private message",
  "encrypted": true,
  "encryptedContent": "..."
}
```

**message_seen** - Mark message as seen
```json
{
  "type": "message_seen",
  "messageId": 123
}
```

**star_message** - Star/favorite a message
```json
{
  "type": "star_message",
  "messageId": 123
}
```

**pin_message** - Pin a message in a room
```json
{
  "type": "pin_message",
  "messageId": 123,
  "roomName": "general"
}
```

**typing** - Typing indicator
```json
{
  "type": "typing",
  "room": "general",
  "isTyping": true
}
```

**exchange_keys** - Signal Protocol key exchange
```json
{
  "type": "exchange_keys",
  "recipientId": "user456",
  "publicKey": "..."
}
```

**get_rooms** - Request room list
```json
{
  "type": "get_rooms"
}
```

**get_users** - Request users in room
```json
{
  "type": "get_users",
  "room": "general"
}
```

#### Server → Client

**joined** - Successfully joined room
```json
{
  "type": "joined",
  "room": "general",
  "history": [...],
  "users": [...],
  "userId": "user123",
  "pendingDMs": 5
}
```

**message** - New message in room
```json
{
  "type": "message",
  "id": 123,
  "username": "Alice",
  "content": "Hello!",
  "created_at": "2025-12-09T..."
}
```

**dm** - Direct message received
```json
{
  "type": "dm",
  "from": "user456",
  "fromUsername": "Bob",
  "content": "Hi!",
  "offline": false
}
```

**dm_sent** - DM delivery confirmation
```json
{
  "type": "dm_sent",
  "to": "user456",
  "status": "delivered",
  "id": 123
}
```

**message_seen** - Message was seen
```json
{
  "type": "message_seen",
  "messageId": 123,
  "seenBy": "user456",
  "seenAt": "2025-12-09T..."
}
```

**typing** - Typing indicator
```json
{
  "type": "typing",
  "roomName": "general",
  "users": ["Alice", "Bob"]
}
```

**user_joined** - User joined room
```json
{
  "type": "user_joined",
  "username": "Alice",
  "roomName": "general",
  "userCount": 5
}
```

**user_left** - User left room
```json
{
  "type": "user_left",
  "username": "Alice",
  "roomName": "general",
  "userCount": 4
}
```

**key_exchange** - Encryption key exchange
```json
{
  "type": "key_exchange",
  "from": "user123",
  "publicKey": "..."
}
```

**error** - Error message
```json
{
  "type": "error",
  "message": "Error description"
}
```

## 🔐 Signal Protocol Usage

### 1. Generate Keys (Client-side)
```typescript
import { SignalProtocol } from './encryption';

// Generate identity key pair
const identityKey = SignalProtocol.generateIdentityKeyPair();

// Generate signed pre-key
const signedPreKey = SignalProtocol.generateSignedPreKey(identityKey, 1);

// Generate one-time pre-keys
const preKeys = SignalProtocol.generatePreKeys(1, 100);
```

### 2. Exchange Keys
```typescript
// Send your public key to recipient
ws.send(JSON.stringify({
  type: "exchange_keys",
  recipientId: "user456",
  publicKey: identityKey.publicKey
}));
```

### 3. Encrypt Message
```typescript
const encrypted = SignalProtocol.encryptMessage(
  "Secret message",
  recipientPublicKey
);

ws.send(JSON.stringify({
  type: "dm",
  recipientId: "user456",
  content: "encrypted",
  encrypted: true,
  encryptedContent: encrypted
}));
```

### 4. Decrypt Message
```typescript
const decrypted = SignalProtocol.decryptMessage(
  encryptedData,
  myPrivateKey
);
```

## 📊 Database Schema

See `schema.sql` for complete schema including:
- users table (with encryption keys)
- messages table (with media support)
- blocked_users table
- user_reports table
- read_receipts table

## 🛠️ Setup

1. Install dependencies:
```bash
bun install
```

2. Setup PostgreSQL database:
```bash
createdb bun_chat
psql bun_chat < schema.sql
```

3. (Optional) Setup RabbitMQ:
```bash
docker run -d -p 5672:5672 -p 15672:15672 rabbitmq:management
```

4. Run the server:
```bash
bun run server.ts
```

## 🔧 Configuration

Edit `db.ts` to configure database connection:
```typescript
export const db = new Pool({
  user: "postgres",
  password: "your_password",
  host: "localhost",
  port: 5432,
  database: "bun_chat",
});
```

## 📝 Notes

- Media compression requires `sharp` (images) and `ffmpeg` (videos) - placeholders included
- Signal Protocol is simplified - for production use `@signalapp/libsignal-client`
- RabbitMQ is optional - falls back to database-only mode
- All media files stored in `./uploads/` directory
- Maximum file size: 100MB
- Supported image formats: JPEG, PNG, GIF, WebP
- Supported video formats: MP4, WebM, QuickTime
- Supported audio formats: MP3, OGG, WAV, WebM
- Supported documents: PDF, Word

## 🚀 Production Recommendations

1. Use proper Signal Protocol library
2. Implement actual media compression
3. Use cloud storage (S3) for media files
4. Add rate limiting
5. Add authentication/authorization
6. Use Redis for session management
7. Add message retention policies
8. Implement backup strategies
9. Add monitoring and logging
10. Use HTTPS/WSS in production
