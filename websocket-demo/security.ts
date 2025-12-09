// Security headers and utilities
import type { Server } from "bun";

// Security headers for HTTP responses
export function getSecurityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  };

  // Add CORS headers if configured
  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin) {
    headers["Access-Control-Allow-Origin"] = corsOrigin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  // Add HSTS in production
  if (process.env.NODE_ENV === "production" && process.env.HTTPS_ENABLED === "true") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}

// Validate input to prevent injection attacks
export function sanitizeInput(input: string, maxLength: number = 1000): string {
  if (!input || typeof input !== "string") {
    return "";
  }

  // Trim and limit length
  let sanitized = input.trim().slice(0, maxLength);

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, "");

  // Remove control characters except newlines and tabs
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

  return sanitized;
}

// Validate user ID format
export function isValidUserId(userId: string): boolean {
  if (!userId || typeof userId !== "string") {
    return false;
  }

  // Allow alphanumeric, dash, underscore, max 255 chars
  return /^[a-zA-Z0-9_-]{1,255}$/.test(userId);
}

// Validate room name
export function isValidRoomName(roomName: string): boolean {
  if (!roomName || typeof roomName !== "string") {
    return false;
  }

  // Allow alphanumeric, dash, underscore, spaces, max 100 chars
  return /^[a-zA-Z0-9_\s-]{1,100}$/.test(roomName);
}

// Validate username
export function isValidUsername(username: string): boolean {
  if (!username || typeof username !== "string") {
    return false;
  }

  // Allow alphanumeric, dash, underscore, max 50 chars
  return /^[a-zA-Z0-9_-]{1,50}$/.test(username);
}

// Check if HTTPS is enabled
export function isHttpsEnabled(): boolean {
  return process.env.HTTPS_ENABLED === "true";
}

// Get SSL options if HTTPS is enabled
export function getSslOptions(): { cert?: string; key?: string } | undefined {
  if (!isHttpsEnabled()) {
    return undefined;
  }

  const certPath = process.env.SSL_CERT_PATH;
  const keyPath = process.env.SSL_KEY_PATH;

  if (!certPath || !keyPath) {
    console.warn("⚠️  HTTPS enabled but SSL_CERT_PATH or SSL_KEY_PATH not set");
    return undefined;
  }

  try {
    const fs = require("fs");
    return {
      cert: fs.readFileSync(certPath, "utf8"),
      key: fs.readFileSync(keyPath, "utf8"),
    };
  } catch (error) {
    console.error("❌ Failed to load SSL certificates:", error);
    return undefined;
  }
}

// Handle CORS preflight requests
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    const headers = getSecurityHeaders();
    return new Response(null, { status: 204, headers });
  }
  return null;
}

