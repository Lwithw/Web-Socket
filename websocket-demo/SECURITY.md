# Security Configuration Guide

This document outlines the security improvements made to the chat server.

## Environment Variables

Create a `.env` file in the project root with the following variables:

```bash
# Database Configuration
DB_USER=postgres
DB_PASSWORD=your_secure_password_here
DB_HOST=localhost
DB_PORT=5432
DB_NAME=bun_chat

# Server Configuration
PORT=3000
NODE_ENV=production
HOST=0.0.0.0

# JWT Authentication (CHANGE THIS IN PRODUCTION!)
JWT_SECRET=your_super_secret_jwt_key_minimum_32_characters_long
JWT_EXPIRES_IN=7d

# RabbitMQ (Optional)
RABBITMQ_URL=amqp://localhost:5672

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_MAX_WS_MESSAGES=50

# HTTPS/WSS (for production)
HTTPS_ENABLED=true
SSL_CERT_PATH=/path/to/cert.pem
SSL_KEY_PATH=/path/to/key.pem

# CORS
CORS_ORIGIN=https://yourdomain.com
```

## Security Features Implemented

### 1. Environment Variables
- All sensitive data (database passwords, JWT secrets) moved to environment variables
- No hardcoded credentials in source code

### 2. JWT Authentication
- Token-based authentication for API requests
- WebSocket connections can authenticate via token in query string or initial message
- Tokens expire after configured time period

### 3. Rate Limiting
- HTTP requests: 100 requests per minute per IP/user
- WebSocket messages: 50 messages per minute per user
- Prevents abuse and DoS attacks

### 4. Database Persistence
- Signal Protocol sessions now persist to database
- No data loss on server restart
- Proper session management

### 5. Security Headers
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin
- HSTS (in production with HTTPS)

### 6. Input Validation
- Sanitization of user inputs
- Validation of user IDs, usernames, room names
- Prevention of injection attacks

## Usage

### Generate JWT Token (for client authentication)

```typescript
import { generateToken } from './auth';

const token = generateToken('user123', 'username');
// Use this token in Authorization header: Bearer <token>
```

### Authenticate HTTP Request

```typescript
import { authenticateRequest } from './auth';

const user = authenticateRequest(request);
if (!user) {
  return new Response('Unauthorized', { status: 401 });
}
```

### Rate Limiting

Rate limiting is automatically applied to all requests. Check rate limit status:

```typescript
import { rateLimitMiddleware } from './rate-limit';

const limit = rateLimitMiddleware(request);
if (!limit.allowed) {
  return new Response('Rate limit exceeded', { 
    status: 429,
    headers: {
      'X-RateLimit-Remaining': limit.remaining.toString(),
      'X-RateLimit-Reset': limit.resetAt.toString()
    }
  });
}
```

## Production Checklist

- [ ] Change JWT_SECRET to a strong random value (minimum 32 characters)
- [ ] Set NODE_ENV=production
- [ ] Enable HTTPS/WSS (set HTTPS_ENABLED=true)
- [ ] Configure SSL certificates
- [ ] Set secure CORS_ORIGIN
- [ ] Use strong database password
- [ ] Review rate limit settings for your use case
- [ ] Set up proper logging and monitoring
- [ ] Configure firewall rules
- [ ] Set up regular backups
- [ ] Review and update dependencies regularly

## Additional Security Recommendations

1. **Add Authentication Layer**: Implement user registration/login endpoints
2. **Add Authorization**: Implement role-based access control
3. **Add Logging**: Log security events (failed auth, rate limits, etc.)
4. **Add Monitoring**: Set up alerts for suspicious activity
5. **Add CSRF Protection**: For state-changing operations
6. **Add Content Security Policy**: Further restrict resource loading
7. **Regular Security Audits**: Review code and dependencies regularly

