# websocket-demo

A feature-rich WebSocket chat server built with Bun, featuring end-to-end encryption, media sharing, and real-time messaging.

## Quick Start

1. **Install dependencies:**
```bash
bun install
```

2. **Set up environment variables:**
   - Create a `.env` file (see [SECURITY.md](./SECURITY.md) for configuration)
   - Configure database credentials and JWT secret

3. **Set up database:**
```bash
createdb bun_chat
psql bun_chat < schema.sql
```

4. **Run the server:**
```bash
bun run server.ts
```

5. **Test with the simple client:**
   - Open `client.html` in your browser (file:// or serve statically)
   - Connect to `ws://localhost:3000/chat`
   - Join a room and send messages/DMs

## Features

- ✅ Real-time messaging (1-on-1, group, broadcast)
- ✅ End-to-end encryption (Signal Protocol)
- ✅ Media sharing (images, videos, documents, voice)
- ✅ Read receipts & typing indicators
- ✅ Message search, star, pin
- ✅ User blocking & reporting
- ✅ Offline message queue
- ✅ JWT authentication
- ✅ Rate limiting
- ✅ Security headers

## API & WebSocket Reference

### REST (HTTP)
- `POST /auth/login` — get JWT token  
  Body: `{ "userId": "user123", "username": "alice" }`
- `GET /rooms` — list active rooms
- `GET /messages?room=general&limit=50` — fetch room history
- `GET /users?room=general` — list online users in a room
- `GET /search?q=hello&userId=user123` — search messages
- `POST /upload` — upload media (multipart: `file`, optional `messageType`)
- `GET /media/:filename` — serve uploaded media
- `POST /block` — block a user (auth)  
  Body: `{ "blockedUserId": "user456" }`
- `POST /report` — report a user (auth)  
  Body: `{ "reportedUserId": "user456", "reason": "spam" }`

Auth: Use `Authorization: Bearer <token>` for protected endpoints.

### WebSocket (ws://localhost:3000/chat)
Optional auth: `?token=<JWT>` on the connection URL.

Client → Server:
- `join` — `{ type, username, userId, room }`
- `leave` — `{ type, room }`
- `message` — `{ type, room, content, mediaUrl?, mediaType? }`
- `dm` — `{ type, recipientId, content, encrypted?, encryptedContent? }`
- `group_message` — `{ type, recipientIds, content, groupName }`
- `typing` — `{ type, room, isTyping }`
- `message_seen` — `{ type, messageId }`
- `star_message` — `{ type, messageId }`
- `pin_message` — `{ type, messageId, roomName }`
- `get_rooms` — `{ type }`
- `get_users` — `{ type, room }`
- Encryption: `init_keys`, `get_bundle`, `encrypted_dm`, `decrypt_message`

Server → Client:
- `joined` — room history, users, pending DMs count
- `message` — room message broadcast
- `dm` — direct message received
- `dm_sent` / `group_message_sent` — delivery status
- `message_seen` — receipt
- `typing` — typing indicators
- `user_joined` / `user_left` — presence changes
- `room_list`, `user_list` — responses to get_rooms/get_users
- `message_pinned`, `message_starred` — status updates
- Encryption: `keys_initialized`, `bundle_received`, `encrypted_dm`, `message_decrypted`
- `error` — error messages

## Documentation

- [SETUP.md](./SETUP.md) - Detailed setup instructions
- [SECURITY.md](./SECURITY.md) - Security configuration guide
- [FEATURES.md](./FEATURES.md) - Complete feature documentation

## Security

This project includes production-ready security features:
- JWT-based authentication
- Rate limiting
- Input validation and sanitization
- Security headers
- Database-backed session storage

**⚠️ Important:** Before deploying to production, update all default credentials and secrets in your `.env` file.

## Technology Stack

- **Runtime:** Bun v1.3.4+
- **Database:** PostgreSQL
- **Message Queue:** RabbitMQ (optional)
- **Encryption:** Signal Protocol
- **Language:** TypeScript

This project was created using `bun init` in bun v1.3.4. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
