/// <reference types="bun-types" />
import type { ServerWebSocket } from "bun";
import { db } from "./db";
import { messageQueue, initMessageQueue } from "./rabbitmq";
import { mediaHandler, type MediaFile } from "./media";
import { signalManager, sessionManager } from "./encryption";
import { userManager } from "./users";
import { messageManager } from "./messages";
import { authenticateRequest, authenticateWebSocket, generateToken } from "./auth";
import { rateLimitMiddleware, rateLimitWebSocket } from "./rate-limit";
import { getSecurityHeaders, sanitizeInput, isValidUserId, isValidRoomName, isValidUsername, handleCorsPreflight, getSslOptions } from "./security";
import { initRedis, onRedisMessage, publishBroadcast, publishSignal, redisEnabled } from "./redis";

// Room-based pub/sub system
type Room = {
  name: string;
  clients: Set<ServerWebSocket>;
};

const rooms = new Map<string, Room>();
const clientRooms = new WeakMap<ServerWebSocket, Set<string>>();
const clientData = new WeakMap<ServerWebSocket, { username: string; userId: string }>();
const userIdToSocket = new Map<string, ServerWebSocket>();
let useRabbitMQ = false;

// Room management
function joinRoom(ws: ServerWebSocket, roomName: string, username: string) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, { name: roomName, clients: new Set() });
    console.log(`🏠 Created new room: ${roomName}`);
  }

  const room = rooms.get(roomName)!;
  room.clients.add(ws);

  if (!clientRooms.has(ws)) {
    clientRooms.set(ws, new Set());
  }
  clientRooms.get(ws)!.add(roomName);

  console.log(`👤 ${username} joined room: ${roomName} (${room.clients.size} users)`);

  broadcastToRoom(roomName, {
    type: "user_joined",
    username,
    roomName,
    userCount: room.clients.size,
    timestamp: new Date().toISOString()
  }, ws);

  return room;
}

function leaveRoom(ws: ServerWebSocket, roomName: string) {
  const room = rooms.get(roomName);
  if (!room) return;

  room.clients.delete(ws);
  clientRooms.get(ws)?.delete(roomName);

  const userData = clientData.get(ws);
  const username = userData?.username || "Anonymous";

  console.log(`👋 ${username} left room: ${roomName} (${room.clients.size} users)`);

  if (room.clients.size === 0) {
    rooms.delete(roomName);
    console.log(`🗑️ Deleted empty room: ${roomName}`);
  } else {
    broadcastToRoom(roomName, {
      type: "user_left",
      username,
      roomName,
      userCount: room.clients.size,
      timestamp: new Date().toISOString()
    });
  }
}

function broadcastToRoom(roomName: string, data: any, exclude?: ServerWebSocket, fromRedis: boolean = false) {
  const room = rooms.get(roomName);
  if (!room) return;

  const payload = JSON.stringify(data);
  let sent = 0;

  for (const client of room.clients) {
    if (client === exclude) continue;
    try {
      client.send(payload);
      sent++;
    } catch (e) {
      console.error("Failed to send to client:", e);
    }
  }

  console.log(`📡 Broadcast to room ${roomName}: ${sent}/${room.clients.size} clients`);

  if (redisEnabled && !fromRedis) {
    publishBroadcast(roomName, data);
  }
}

async function getOnlineUsers(roomName: string): Promise<string[]> {
  const room = rooms.get(roomName);
  if (!room) return [];

  const users: string[] = [];
  for (const client of room.clients) {
    const userData = clientData.get(client);
    if (userData) {
      users.push(userData.username);
    }
  }
  return users;
}

async function getRoomList(): Promise<{ name: string; userCount: number }[]> {
  return Array.from(rooms.entries()).map(([name, room]) => ({
    name,
    userCount: room.clients.size
  }));
}

// Typing indicators
const typingUsers = new Map<string, Set<string>>();

function setTyping(roomName: string, username: string, isTyping: boolean) {
  if (!typingUsers.has(roomName)) {
    typingUsers.set(roomName, new Set());
  }

  const roomTyping = typingUsers.get(roomName)!;
  
  if (isTyping) {
    roomTyping.add(username);
  } else {
    roomTyping.delete(username);
  }

  broadcastToRoom(roomName, {
    type: "typing",
    roomName,
    users: Array.from(roomTyping)
  });
}

// Test database and create enhanced schema
async function testDatabase() {
  try {
    await db.query("SELECT 1");
    console.log("✅ Database connection successful");
    
    // Run schema.sql to create all tables
    const schemaFile = await Bun.file("schema.sql").text();
    await db.query(schemaFile);
    console.log("✅ Database schema initialized");
    
  } catch (err) {
    console.error("❌ Database test failed:", err);
    process.exit(1);
  }
}

const server = Bun.serve({
  port: parseInt(process.env.PORT || "3000"),
  hostname: process.env.HOST || "0.0.0.0",
  ...(getSslOptions() || {}),

  async fetch(req, server) {
    const url = new URL(req.url);

    // Handle CORS preflight
    const corsResponse = handleCorsPreflight(req);
    if (corsResponse) return corsResponse;

    // Apply rate limiting
    const rateLimit = rateLimitMiddleware(req);
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ success: false, error: "Rate limit exceeded" }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": rateLimit.remaining.toString(),
            "X-RateLimit-Reset": rateLimit.resetAt.toString(),
            ...getSecurityHeaders(),
          },
        }
      );
    }

    // WebSocket upgrade
    if (url.pathname === "/chat") {
      // Optional: Authenticate WebSocket upgrade
      const token = url.searchParams.get("token");
      if (token) {
        const user = authenticateWebSocket(token);
        if (!user) {
          return new Response("Unauthorized", { status: 401 });
        }
      }
      
      if (server.upgrade(req, { data: { token } })) return;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Authentication endpoint (for getting JWT token)
    if (url.pathname === "/auth/login" && req.method === "POST") {
      try {
        const body = await req.json() as { userId: string; username: string };
        
        if (!body.userId || !body.username) {
          return new Response(
            JSON.stringify({ success: false, error: "userId and username required" }),
            { status: 400, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
          );
        }

        if (!isValidUserId(body.userId) || !isValidUsername(body.username)) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid userId or username format" }),
            { status: 400, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
          );
        }

        const token = generateToken(body.userId, sanitizeInput(body.username));
        return new Response(
          JSON.stringify({ success: true, token, userId: body.userId, username: body.username }),
          { headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      }
    }

    // Media upload endpoint
    if (url.pathname === "/upload" && req.method === "POST") {
      // Authenticate request
      const user = authenticateRequest(req);
      if (!user) {
        return new Response(
          JSON.stringify({ success: false, error: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      }

      try {
        const formData = await req.formData();
        const file = formData.get("file") as File;
        const userId = user.userId; // Use authenticated user ID
        const messageType = (formData.get("messageType") as string) || "image";

        if (!file) {
          return new Response(
            JSON.stringify({ success: false, error: "file required" }),
            { status: 400, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
          );
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const mediaFile = await mediaHandler.saveFile(buffer, file.type, messageType as any, file.name);
        
        return new Response(
          JSON.stringify({ success: true, media: mediaFile }),
          { headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      } catch (err) {
        console.error("❌ Upload error:", err);
        return new Response(
          JSON.stringify({ success: false, error: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      }
    }

    // Serve uploaded media
    if (url.pathname.startsWith("/media/")) {
      const filename = url.pathname.split("/media/")[1];
      try {
        const file = Bun.file(`uploads/${filename}`);
        if (await file.exists()) {
          return new Response(file);
        }
        return new Response("File not found", { status: 404 });
      } catch (err) {
        return new Response("Error serving file", { status: 500 });
      }
    }

    // REST API Endpoints
    if (url.pathname === "/rooms" && req.method === "GET") {
      // Optional: Require authentication
      // const user = authenticateRequest(req);
      // if (!user) {
      //   return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
      //     status: 401, headers: { "Content-Type": "application/json", ...getSecurityHeaders() }
      //   });
      // }

      try {
        const roomList = await getRoomList();
        return new Response(JSON.stringify({ success: true, rooms: roomList }), {
          headers: { "Content-Type": "application/json", ...getSecurityHeaders() }
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      }
    }

    if (url.pathname === "/messages" && req.method === "GET") {
      try {
        const roomName = url.searchParams.get("room") || "general";
        if (!isValidRoomName(roomName)) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid room name" }),
            { status: 400, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
          );
        }
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100); // Max 100
        const msgs = await messageManager.getMessages({ roomName, limit });
        return new Response(JSON.stringify({ success: true, room: roomName, messages: msgs }), {
          headers: { "Content-Type": "application/json", ...getSecurityHeaders() }
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      }
    }

    if (url.pathname === "/users" && req.method === "GET") {
      try {
        const roomName = url.searchParams.get("room") || "general";
        const users = await getOnlineUsers(roomName);
        return new Response(
          JSON.stringify({ success: true, room: roomName, users }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Search messages
    if (url.pathname === "/search" && req.method === "GET") {
      try {
        const query = url.searchParams.get("q") || "";
        const userId = url.searchParams.get("userId") || "";
        const results = await messageManager.searchMessages(userId, query);
        return new Response(
          JSON.stringify({ success: true, results }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Block user
    if (url.pathname === "/block" && req.method === "POST") {
      const user = authenticateRequest(req);
      if (!user) {
        return new Response(
          JSON.stringify({ success: false, error: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      }

      try {
        const body = await req.json() as { blockedUserId: string };
        if (!body.blockedUserId || !isValidUserId(body.blockedUserId)) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid blockedUserId" }),
            { status: 400, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
          );
        }
        await userManager.blockUser(user.userId, body.blockedUserId);
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      }
    }

    // Report user
    if (url.pathname === "/report" && req.method === "POST") {
      const user = authenticateRequest(req);
      if (!user) {
        return new Response(
          JSON.stringify({ success: false, error: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      }

      try {
        const body = await req.json() as { reportedUserId: string; reason: string };
        if (!body.reportedUserId || !isValidUserId(body.reportedUserId)) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid reportedUserId" }),
            { status: 400, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
          );
        }
        const reason = sanitizeInput(body.reason || "", 500);
        if (!reason) {
          return new Response(
            JSON.stringify({ success: false, error: "Reason required" }),
            { status: 400, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
          );
        }
        await userManager.reportUser(user.userId, body.reportedUserId, reason);
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...getSecurityHeaders() } }
        );
      }
    }

    return new Response("Enhanced Chat Server", { 
      status: 200,
      headers: getSecurityHeaders()
    });
  },

  websocket: {
    async open(ws) {
      console.log("🔌 New WebSocket connection");
      
      // Optional: Authenticate WebSocket on open
      const token = ws.data?.token;
      if (token) {
        const user = authenticateWebSocket(token);
        if (user) {
          // Store user data in WebSocket
          (ws as any).userData = user;
        }
      }
    },

    async message(ws, msg) {
      // Apply rate limiting
      const userData = (ws as any).userData;
      const identifier = userData ? `user:${userData.userId}` : `ws:${ws.remoteAddress}`;
      const rateLimit = rateLimitWebSocket(identifier);
      
      if (!rateLimit.allowed) {
        ws.send(JSON.stringify({
          type: "error",
          message: "Rate limit exceeded",
          remaining: rateLimit.remaining,
          resetAt: rateLimit.resetAt
        }));
        return;
      }

      let data;
      try { 
        data = JSON.parse(msg.toString()); 
      } catch { 
        console.warn("⚠️ Invalid JSON");
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return; 
      }

      console.log("📩 WS message:", data.type);

      // JOIN
      if (data.type === "join") {
        const username = sanitizeInput(String(data.username || "Anonymous"), 50);
        const roomName = sanitizeInput(String(data.room || "general"), 100);
        const userId = String(data.userId || Date.now());

        // Validate inputs
        if (!isValidUsername(username)) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid username format" }));
          return;
        }
        if (!isValidRoomName(roomName)) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid room name format" }));
          return;
        }
        if (!isValidUserId(userId)) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid userId format" }));
          return;
        }

        clientData.set(ws, { username, userId });
        userIdToSocket.set(userId, ws);
        joinRoom(ws, roomName, username);

        try {
          const history = await messageManager.getMessages({ roomName, limit: 50 });
          const users = await getOnlineUsers(roomName);
          // Get undelivered messages for this user
          const allPending = await messageManager.getMessages({ recipientId: userId, limit: 100 });
          const pendingDMs = allPending.filter(m => !m.delivered);
          
          ws.send(JSON.stringify({ 
            type: "joined", 
            room: roomName,
            history, 
            users,
            userId,
            pendingDMs: pendingDMs.length,
            timestamp: new Date().toISOString()
          }));

          // Deliver pending messages
          if (pendingDMs.length > 0) {
            console.log(`📬 Delivering ${pendingDMs.length} pending messages to ${username}`);

            for (const msg of pendingDMs) {
              ws.send(JSON.stringify({
                type: msg.messageType === "text" ? "dm" : "group_message",
                ...msg,
                offline: true
              }));
              await messageManager.markDelivered(msg.id);
            }
          }
        } catch (err) {
          console.error("Error sending history:", err);
        }
      }

      // LEAVE
      else if (data.type === "leave") {
        const roomName = String(data.room || "general");
        leaveRoom(ws, roomName);
        ws.send(JSON.stringify({ type: "left", room: roomName }));
      }

      // MESSAGE
      else if (data.type === "message") {
        const userData = clientData.get(ws);
        if (!userData) {
          ws.send(JSON.stringify({ type: "error", message: "Not authenticated. Please join first." }));
          return;
        }
        const username = userData.username;
        const content = sanitizeInput(String(data.content || "").trim(), 5000);
        const roomName = sanitizeInput(String(data.room || "general"), 100);
        
        if (!content) {
          ws.send(JSON.stringify({ type: "error", message: "Content required" }));
          return;
        }
        if (!isValidRoomName(roomName)) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid room name" }));
          return;
        }

        try {
          const savedMsg = await messageManager.saveMessage({
            senderId: userData?.userId || "",
            username,
            content,
            roomName,
            messageType: data.mediaType || "text",
            mediaUrl: data.mediaUrl,
            mediaType: data.mediaType
          });

          broadcastToRoom(roomName, {
            type: "message",
            ...savedMsg
          });
        } catch (err) {
          console.error("❌ Error processing message:", err);
          ws.send(JSON.stringify({ type: "error", message: "Failed to save message" }));
        }
      }

      // DM
      else if (data.type === "dm") {
        const userData = clientData.get(ws);
        if (!userData) {
          ws.send(JSON.stringify({ 
            type: "error", 
            message: "Not authenticated" 
          }));
          return;
        }

        const username = userData.username;
        const recipientId = String(data.recipientId || "");
        const content = sanitizeInput(String(data.content || "").trim(), 5000);

        // Validate inputs
        if (!isValidUserId(recipientId)) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid recipientId format" }));
          return;
        }

        if (!recipientId || !content) {
          ws.send(JSON.stringify({ type: "error", message: "recipientId and content required" }));
          return;
        }

        // Check if blocked
        const isBlocked = await userManager.isBlocked(userData.userId, recipientId);
        if (isBlocked) {
          ws.send(JSON.stringify({ type: "error", message: "Cannot send message to this user" }));
          return;
        }

        const recipientSocket = userIdToSocket.get(recipientId);
        
        try {
          const savedMsg = await messageManager.saveMessage({
            senderId: userData.userId,
            username,
            content,
            messageType: data.mediaType || "text",
            recipientId,
            mediaUrl: data.mediaUrl,
            mediaType: data.mediaType,
            encrypted: data.encrypted || false,
            encryptionMetadata: data.encryptedContent ? { encryptedContent: data.encryptedContent } : undefined
          });
          
          if (!recipientSocket) {
            console.log(`📭 User ${recipientId} is offline. Message saved for later delivery.`);
            
            if (useRabbitMQ) {
              await messageQueue.queueOfflineMessage({
                recipientId,
                from: userData.userId,
                fromUsername: username,
                content,
                messageType: 'dm',
                messageId: savedMsg.id
              });
            }
            
            ws.send(JSON.stringify({
              type: "dm_sent",
              to: recipientId,
              status: "offline",
              ...savedMsg
            }));
            return;
          }

          recipientSocket.send(JSON.stringify({
            type: "dm",
            from: userData.userId,
            fromUsername: username,
            ...savedMsg
          }));

          await messageManager.markDelivered(savedMsg.id);

          ws.send(JSON.stringify({
            type: "dm_sent",
            to: recipientId,
            status: "delivered",
            ...savedMsg
          }));

          console.log(`💌 DM from ${username} to ${recipientId} - delivered`);
        } catch (err) {
          console.error("❌ Error sending DM:", err);
          ws.send(JSON.stringify({ type: "error", message: "Failed to send DM" }));
        }
      }

      // WEBRTC SIGNAL FORWARDING
      else if (data.type === "signal") {
        const userData = clientData.get(ws);
        if (!userData) {
          ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
          return;
        }

        const to = String(data.to || "");
        const payload = data.payload;

        if (!isValidUserId(to)) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid recipientId format" }));
          return;
        }
        if (!payload || typeof payload !== "object") {
          ws.send(JSON.stringify({ type: "error", message: "Missing signal payload" }));
          return;
        }

        const recipientSocket = userIdToSocket.get(to);
        if (!recipientSocket) {
          if (redisEnabled) {
            publishSignal(to, payload);
            ws.send(JSON.stringify({ type: "signal_sent", to, ok: true, via: "redis" }));
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Recipient not connected" }));
          }
          return;
        }

        try {
          recipientSocket.send(JSON.stringify({
            type: "signal",
            from: userData.userId,
            payload
          }));
          ws.send(JSON.stringify({ type: "signal_sent", to, ok: true }));
        } catch (err) {
          console.error("❌ Error forwarding signal:", err);
          ws.send(JSON.stringify({ type: "error", message: "Failed to forward signal" }));
        }
      }

      // MESSAGE_SEEN - Read receipt
      else if (data.type === "message_seen") {
        const userData = clientData.get(ws);
        if (!userData) return;

        const messageId = data.messageId;
        if (!messageId) return;

        try {
          await messageManager.markSeen(messageId, userData.userId);
          
          // Get receipts to find sender
          const receipts = await messageManager.getReadReceipts(messageId);
          console.log(`✅ Message ${messageId} marked as seen by ${userData.userId}`);
        } catch (err) {
          console.error("❌ Error marking message as seen:", err);
        }
      }

      // STAR_MESSAGE
      else if (data.type === "star_message") {
        const userData = clientData.get(ws);
        if (!userData) return;

        try {
          await messageManager.toggleStar(data.messageId, userData.userId);
          ws.send(JSON.stringify({ type: "message_starred", messageId: data.messageId }));
        } catch (err) {
          console.error("❌ Error starring message:", err);
        }
      }

      // PIN_MESSAGE
      else if (data.type === "pin_message") {
        const userData = clientData.get(ws);
        if (!userData) return;

        try {
          await messageManager.togglePin(data.messageId, data.roomName);
          broadcastToRoom(data.roomName, {
            type: "message_pinned",
            messageId: data.messageId,
            pinnedBy: userData.username
          });
        } catch (err) {
          console.error("❌ Error pinning message:", err);
        }
      }

      // TYPING
      else if (data.type === "typing") {
        const userData = clientData.get(ws);
        if (!userData) return;
        
        const roomName = String(data.room || "general");
        const isTyping = Boolean(data.isTyping);
        
        setTyping(roomName, userData.username, isTyping);
      }

      // GET_ROOMS
      else if (data.type === "get_rooms") {
        const roomList = await getRoomList();
        ws.send(JSON.stringify({ type: "room_list", rooms: roomList }));
      }

      // GET_USERS
      else if (data.type === "get_users") {
        const roomName = String(data.room || "general");
        const users = await getOnlineUsers(roomName);
        ws.send(JSON.stringify({ type: "user_list", room: roomName, users }));
      }

      // INIT_KEYS - Initialize Signal Protocol keys
      else if (data.type === "init_keys") {
        const userData = clientData.get(ws);
        if (!userData) return;

        try {
          const keys = await signalManager.initializeUser(userData.userId);
          ws.send(JSON.stringify({
            type: "keys_initialized",
            ...keys
          }));
          console.log(`✅ Keys initialized for ${userData.username}`);
        } catch (err) {
          console.error("❌ Error initializing keys:", err);
          ws.send(JSON.stringify({ type: "error", message: "Failed to initialize keys" }));
        }
      }

      // GET_BUNDLE - Get recipient's pre-key bundle
      else if (data.type === "get_bundle") {
        const userData = clientData.get(ws);
        if (!userData) return;

        try {
          const recipientId = data.recipientId;
          const bundle = await signalManager.getUserPreKeyBundle(recipientId);
          
          if (!bundle) {
            ws.send(JSON.stringify({ 
              type: "error", 
              message: "Recipient has not initialized encryption keys" 
            }));
            return;
          }

          ws.send(JSON.stringify({
            type: "bundle_received",
            recipientId,
            bundle
          }));
        } catch (err) {
          console.error("❌ Error getting bundle:", err);
          ws.send(JSON.stringify({ type: "error", message: "Failed to get pre-key bundle" }));
        }
      }

      // ENCRYPTED_DM - Send encrypted direct message
      else if (data.type === "encrypted_dm") {
        const userData = clientData.get(ws);
        if (!userData) {
          ws.send(JSON.stringify({ 
            type: "error", 
            message: "Not authenticated" 
          }));
          return;
        }

        const recipientId = String(data.recipientId || "");
        const message = String(data.message || "");

        if (!recipientId || !message) {
          ws.send(JSON.stringify({ type: "error", message: "recipientId and message required" }));
          return;
        }

        try {
          // Encrypt the message
          const encrypted = await signalManager.encryptMessage(
            userData.userId,
            recipientId,
            message
          );

          // Save encrypted message
          const savedMsg = await messageManager.saveMessage({
            senderId: userData.userId,
            username: userData.username,
            content: "[Encrypted]",
            messageType: "text",
            recipientId,
            encrypted: true,
            encryptionMetadata: encrypted
          });

          const recipientSocket = userIdToSocket.get(recipientId);
          
          if (!recipientSocket) {
            console.log(`📭 User ${recipientId} is offline. Encrypted message saved.`);
            
            if (useRabbitMQ) {
              await messageQueue.queueOfflineMessage({
                recipientId,
                from: userData.userId,
                fromUsername: userData.username,
                content: "[Encrypted]",
                messageType: 'dm',
                messageId: savedMsg.id
              });
            }
            
            ws.send(JSON.stringify({
              type: "encrypted_dm_sent",
              to: recipientId,
              status: "offline",
              messageId: savedMsg.id
            }));
            return;
          }

          // Deliver encrypted message
          recipientSocket.send(JSON.stringify({
            type: "encrypted_dm",
            from: userData.userId,
            fromUsername: userData.username,
            messageId: savedMsg.id,
            encrypted: encrypted,
            created_at: savedMsg.createdAt
          }));

          await messageManager.markDelivered(savedMsg.id);

          ws.send(JSON.stringify({
            type: "encrypted_dm_sent",
            to: recipientId,
            status: "delivered",
            messageId: savedMsg.id
          }));

          console.log(`🔐 Encrypted DM from ${userData.username} to ${recipientId}`);
        } catch (err) {
          console.error("❌ Error sending encrypted DM:", err);
          ws.send(JSON.stringify({ 
            type: "error", 
            message: `Failed to send encrypted message: ${err}` 
          }));
        }
      }

      // DECRYPT_MESSAGE - Decrypt received message (client-side should handle this)
      else if (data.type === "decrypt_message") {
        const userData = clientData.get(ws);
        if (!userData) return;

        try {
          const senderId = data.senderId;
          const encrypted = data.encrypted;

          const decrypted = await signalManager.decryptMessage(
            userData.userId,
            senderId,
            encrypted
          );

          ws.send(JSON.stringify({
            type: "message_decrypted",
            messageId: data.messageId,
            decrypted
          }));
        } catch (err) {
          console.error("❌ Error decrypting message:", err);
          ws.send(JSON.stringify({ 
            type: "error", 
            message: "Failed to decrypt message" 
          }));
        }
      }
    },

    close(ws) {
      const userData = clientData.get(ws);
      const userRooms = clientRooms.get(ws);
      
      if (userRooms) {
        for (const roomName of userRooms) {
          leaveRoom(ws, roomName);
        }
      }

      if (userData) {
        userIdToSocket.delete(userData.userId);
      }

      console.log(`🔌 Disconnected: ${userData?.username || "Unknown"}`);
    }
  },
});

// Initialize
await testDatabase();

const redisStarted = await initRedis();
if (redisStarted) {
  console.log("✅ Redis enabled for WebSocket pub/sub");
  onRedisMessage((msg) => {
    if (msg.type === "broadcast") {
      broadcastToRoom(msg.room, msg.data, undefined, true);
    } else if (msg.type === "signal") {
      const recipientSocket = userIdToSocket.get(msg.to);
      if (recipientSocket) {
        recipientSocket.send(JSON.stringify({
          type: "signal",
          from: msg.from,
          payload: msg.payload
        }));
      }
    }
  });
} else {
  console.log("ℹ️ Redis not configured; running single-instance WebSocket handling");
}

const mqInstance = await initMessageQueue();
useRabbitMQ = mqInstance !== null;

if (useRabbitMQ) {
  console.log("✅ Using RabbitMQ for message queuing");
} else {
  console.log("⚠️ Using database-only mode for offline messages");
}

console.log(`
🚀 Enhanced Chat Server with E2E Encryption
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 WebSocket: ws://localhost:${server.port}/chat
📤 Upload: http://localhost:${server.port}/upload
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Features:
  ✅ Text, Emoji, Stickers, GIFs
  ✅ Media (Images, Videos, Docs, Voice)
  ✅ E2E Encryption (Signal Protocol)
  ✅ Read Receipts & Typing Indicators
  ✅ Star/Pin Messages
  ✅ Block/Report Users
  ✅ Message Search
  ✅ Offline Message Queue
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
