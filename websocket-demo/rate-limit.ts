// Rate limiting middleware
interface RateLimitStore {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private store: Map<string, RateLimitStore> = new Map();
  private windowMs: number;
  private maxRequests: number;
  private maxWsMessages: number;

  constructor() {
    this.windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"); // 1 minute
    this.maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100");
    this.maxWsMessages = parseInt(process.env.RATE_LIMIT_MAX_WS_MESSAGES || "50");
    
    // Clean up expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  // Check rate limit for HTTP requests
  checkLimit(identifier: string, isWebSocket: boolean = false): { allowed: boolean; remaining: number; resetAt: number } {
    const key = identifier;
    const max = isWebSocket ? this.maxWsMessages : this.maxRequests;
    const now = Date.now();
    
    let entry = this.store.get(key);
    
    if (!entry || now > entry.resetTime) {
      // Create new window
      entry = {
        count: 0,
        resetTime: now + this.windowMs
      };
    }
    
    entry.count++;
    this.store.set(key, entry);
    
    const allowed = entry.count <= max;
    const remaining = Math.max(0, max - entry.count);
    
    return {
      allowed,
      remaining,
      resetAt: entry.resetTime
    };
  }

  // Get client identifier from request
  getIdentifier(req: Request, ws?: any): string {
    // Try to get user ID from auth token first
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const token = authHeader.split(" ")[1];
      if (token) {
        try {
          const decoded = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
          if (decoded.userId) {
            return `user:${decoded.userId}`;
          }
        } catch {}
      }
    }
    
    // Fall back to IP address
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0].trim() : 
               req.headers.get("x-real-ip") || 
               "unknown";
    
    return `ip:${ip}`;
  }

  // Clean up expired entries
  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }

  // Reset rate limit for a specific identifier
  reset(identifier: string) {
    this.store.delete(identifier);
  }
}

export const rateLimiter = new RateLimiter();

// Rate limit middleware for HTTP requests
export function rateLimitMiddleware(req: Request): { allowed: boolean; remaining: number; resetAt: number } | null {
  const identifier = rateLimiter.getIdentifier(req);
  return rateLimiter.checkLimit(identifier, false);
}

// Rate limit for WebSocket messages
export function rateLimitWebSocket(identifier: string): { allowed: boolean; remaining: number; resetAt: number } {
  return rateLimiter.checkLimit(identifier, true);
}

