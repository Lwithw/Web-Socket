# Changelog - Security Improvements

## Security Fixes Applied

### ✅ 1. Environment Variables
- **Fixed:** Removed hardcoded database password from `db.ts`
- **Added:** Environment variable support for all database configuration
- **Added:** Support for connection pooling configuration via env vars
- **Files Changed:** `db.ts`

### ✅ 2. JWT Authentication
- **Added:** Complete JWT-based authentication system
- **Added:** Token generation endpoint (`/auth/login`)
- **Added:** Authentication middleware for HTTP requests
- **Added:** WebSocket authentication support
- **Files Created:** `auth.ts`
- **Files Changed:** `server.ts` (renamed from `server-enhanced.ts`), `package.json`

### ✅ 3. Rate Limiting
- **Added:** Rate limiting for HTTP requests (100 req/min per IP/user)
- **Added:** Rate limiting for WebSocket messages (50 msg/min per user)
- **Added:** Automatic cleanup of expired rate limit entries
- **Added:** Rate limit headers in responses
- **Files Created:** `rate-limit.ts`
- **Files Changed:** `server.ts` (renamed from `server-enhanced.ts`)

### ✅ 4. Database Persistence for Signal Protocol
- **Fixed:** Signal Protocol sessions now persist to database
- **Fixed:** Identity stores use database instead of in-memory
- **Fixed:** Pre-key stores use database instead of in-memory
- **Fixed:** Signed pre-key stores use database instead of in-memory
- **Files Changed:** `encryption.ts`

### ✅ 5. Security Headers
- **Added:** X-Content-Type-Options: nosniff
- **Added:** X-Frame-Options: DENY
- **Added:** X-XSS-Protection: 1; mode=block
- **Added:** Referrer-Policy: strict-origin-when-cross-origin
- **Added:** HSTS support for HTTPS
- **Added:** CORS configuration support
- **Files Created:** `security.ts`
- **Files Changed:** `server.ts` (renamed from `server-enhanced.ts`)

### ✅ 6. Input Validation & Sanitization
- **Added:** Input sanitization to prevent injection attacks
- **Added:** Validation for user IDs, usernames, room names
- **Added:** Content length limits
- **Files Created:** `security.ts`
- **Files Changed:** `server.ts` (renamed from `server-enhanced.ts`)

### ✅ 7. HTTPS/WSS Support
- **Added:** SSL/TLS configuration support
- **Added:** Environment variable configuration for HTTPS
- **Files Changed:** `security.ts`, `server.ts` (renamed from `server-enhanced.ts`)

### ✅ 8. Documentation
- **Added:** `SECURITY.md` - Security configuration guide
- **Added:** `SETUP.md` - Setup instructions
- **Added:** `client.html` - Simple test client
- **Updated:** `README.md` - Added security information
- **Files Created:** `SECURITY.md`, `SETUP.md`
- **Files Changed:** `README.md`

## Breaking Changes

⚠️ **Database Configuration:** Database credentials must now be provided via environment variables. Create a `.env` file before running the server.

⚠️ **Authentication:** Some endpoints now require authentication. Use `/auth/login` to get a JWT token.

⚠️ **Rate Limiting:** Rate limits are now enforced. Adjust `RATE_LIMIT_*` environment variables if needed.

## Migration Guide

1. **Create `.env` file:**
   ```bash
   DB_USER=postgres
   DB_PASSWORD=your_password
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=bun_chat
   JWT_SECRET=your_super_secret_jwt_key_minimum_32_characters
   PORT=3000
   ```

2. **Install new dependencies:**
   ```bash
   bun install
   ```

3. **Update client code:**
   - Get JWT token from `/auth/login` endpoint
   - Include token in `Authorization: Bearer <token>` header for HTTP requests
   - Include token in WebSocket query string: `ws://localhost:3000/chat?token=<token>`

## Next Steps for Production

1. Set strong `JWT_SECRET` (minimum 32 characters, random)
2. Enable HTTPS (`HTTPS_ENABLED=true`) and configure SSL certificates
3. Set `NODE_ENV=production`
4. Configure appropriate `CORS_ORIGIN`
5. Review and adjust rate limit settings
6. Set up monitoring and logging
7. Regular security audits

