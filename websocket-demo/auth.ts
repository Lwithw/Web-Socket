// Authentication middleware using JWT
import jwt from "jsonwebtoken";

export interface UserPayload {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
}

const JWT_SECRET = process.env.JWT_SECRET || "your_super_secret_jwt_key_change_this_in_production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// Generate JWT token
export function generateToken(userId: string, username: string): string {
  return jwt.sign(
    { userId, username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// Verify JWT token
export function verifyToken(token: string): UserPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as UserPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

// Decode token without verification (for debugging)
export function decodeToken(token: string): UserPayload | null {
  try {
    return jwt.decode(token) as UserPayload;
  } catch (error) {
    return null;
  }
}

// Extract token from Authorization header
export function extractToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null;
  }
  
  return parts[1];
}

// Authentication middleware for HTTP requests
export function authenticateRequest(req: Request): UserPayload | null {
  const authHeader = req.headers.get("authorization");
  const token = extractToken(authHeader);
  
  if (!token) {
    return null;
  }
  
  return verifyToken(token);
}

// WebSocket authentication (token passed in query string or initial message)
export function authenticateWebSocket(token: string): UserPayload | null {
  return verifyToken(token);
}

