# Setup Guide

## Prerequisites

- Bun runtime (v1.3.4+)
- PostgreSQL database
- (Optional) RabbitMQ for message queuing

## Installation

1. **Install dependencies:**
```bash
bun install
```

2. **Set up environment variables:**
   - Copy the example environment file (create `.env` manually based on SECURITY.md)
   - Update database credentials and JWT secret

3. **Set up PostgreSQL database:**
```bash
createdb bun_chat
psql bun_chat < schema.sql
```

4. **Configure environment variables:**
   Create a `.env` file with:
```bash
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=bun_chat
JWT_SECRET=your_super_secret_jwt_key_minimum_32_characters
PORT=3000
```

5. **Run the server:**
```bash
bun run server.ts
```

6. **(Optional) Use the test client**
   - Open `client.html` in your browser (file:// or serve it with any static server)
   - Connect to `ws://localhost:3000/chat`
   - Join a room and send messages/DMs

## Authentication

### Getting a JWT Token

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userId": "user123", "username": "alice"}'
```

Response:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "user123",
  "username": "alice"
}
```

### Using the Token

**HTTP Requests:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/rooms
```

**WebSocket Connection:**
```javascript
const ws = new WebSocket('ws://localhost:3000/chat?token=YOUR_TOKEN');
```

## Security Features

- ✅ JWT-based authentication
- ✅ Rate limiting (100 HTTP requests/min, 50 WS messages/min)
- ✅ Input validation and sanitization
- ✅ Security headers (XSS protection, frame options, etc.)
- ✅ Database-backed session storage
- ✅ HTTPS/WSS support (configure in .env)

See [SECURITY.md](./SECURITY.md) for detailed security configuration.

## Development vs Production

### Development
- Set `NODE_ENV=development`
- Use HTTP/WS (not HTTPS/WSS)
- Less strict rate limits
- Debug logging enabled

### Production
- Set `NODE_ENV=production`
- Enable HTTPS/WSS (`HTTPS_ENABLED=true`)
- Configure SSL certificates
- Use strong JWT_SECRET (32+ characters)
- Set appropriate CORS_ORIGIN
- Review rate limit settings

## Troubleshooting

### Database Connection Issues
- Check PostgreSQL is running: `pg_isready`
- Verify credentials in `.env`
- Check database exists: `psql -l | grep bun_chat`

### Rate Limit Errors
- Check rate limit settings in `.env`
- Rate limits reset after the window period
- Use authentication to get user-based limits instead of IP-based

### Authentication Errors
- Verify JWT_SECRET is set in `.env`
- Check token hasn't expired
- Ensure token is sent in correct format: `Bearer <token>`

