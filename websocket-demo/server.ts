/// <reference types="bun-types" />
import type { WebSocket } from "bun";
import { db } from "./db";
import { messageQueue, initMessageQueue } from "./rabbitmq";

type MsgRow = { id: number; username: string; content: string; created_at: string };

// Room-based pub/sub system
type Room = {
  name: string;
  clients: Set<WebSocket>;
};

const rooms = new Map<string, Room>();
const clientRooms = new WeakMap<WebSocket, Set<string>>(); // Track which rooms each client is in
const clientData = new WeakMap<WebSocket, { username: string; userId: string }>(); // Track client metadata
const userIdToSocket = new Map<string, WebSocket>(); // userId -> WebSocket for DMs
let useRabbitMQ = false; // Flag to check if RabbitMQ is available

// Room management
function joinRoom(ws: WebSocket, roomName: string, username: string) {
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

  // Notify room members
  broadcastToRoom(roomName, {
    type: "user_joined",
    username,
    roomName,
    userCount: room.clients.size,
    timestamp: new Date().toISOString()
  }, ws);

  return room;
}

function leaveRoom(ws: WebSocket, roomName: string) {
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

function broadcastToRoom(roomName: string, data: any, exclude?: WebSocket) {
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
}

// Database functions
async function getMessages(roomName: string = "general", limit: number = 50): Promise<MsgRow[]> {
  try {
    const res = await db.query(
      "SELECT id, username, content, created_at FROM messages WHERE room_name = $1 ORDER BY id DESC LIMIT $2",
      [roomName, limit]
    );
    console.log(`✅ Retrieved ${res.rows.length} messages from room: ${roomName}`);
    return res.rows.reverse();
  } catch (err) {
    console.error("❌ DB Error fetching messages:", err);
    return [];
  }
}

async function getPendingDMs(userId: string): Promise<any[]> {
  try {
    const res = await db.query(
      `SELECT id, username, content, message_type, recipient_id, created_at 
       FROM messages 
       WHERE message_type = 'dm' 
       AND recipient_id = $1 
       AND delivered = false 
       ORDER BY created_at ASC`,
      [userId]
    );
    console.log(`✅ Retrieved ${res.rows.length} pending DMs for user: ${userId}`);
    return res.rows;
  } catch (err) {
    console.error("❌ DB Error fetching pending DMs:", err);
    return [];
  }
}

async function markDMsAsDelivered(messageIds: number[]) {
  try {
    await db.query(
      "UPDATE messages SET delivered = true WHERE id = ANY($1)",
      [messageIds]
    );
    console.log(`✅ Marked ${messageIds.length} DMs as delivered`);
  } catch (err) {
    console.error("❌ DB Error marking DMs as delivered:", err);
  }
}

async function saveMessage(username: string, content: string, roomName: string = "general", messageType: string = "room", recipientId?: string) {
  console.log(`💾 Saving: user="${username}", type="${messageType}", room="${roomName}", content="${content}"`);
  
  try {
    const result = await db.query(
      "INSERT INTO messages (username, content, room_name, message_type, recipient_id, delivered) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, content, room_name, message_type, recipient_id, delivered, created_at",
      [username, content, roomName, messageType, recipientId || null, messageType === 'room' ? true : false]
    );
    
    console.log(`✅ Message saved:`, result.rows[0]);
    return result.rows[0];
  } catch (err) {
    console.error("❌ DB Error saving message:", err);
    throw err;
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
const typingUsers = new Map<string, Set<string>>(); // roomName -> Set<username>

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

// Test database and create schema
async function testDatabase() {
  try {
    await db.query("SELECT 1");
    console.log("✅ Database connection successful");
    
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'messages'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log("Creating messages table with room support...");
      
      await db.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) NOT NULL DEFAULT 'Anonymous',
          content TEXT NOT NULL,
          room_name VARCHAR(255) NOT NULL DEFAULT 'general',
          message_type VARCHAR(50) NOT NULL DEFAULT 'room',
          recipient_id VARCHAR(255),
          delivered BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          edited_at TIMESTAMP,
          deleted_at TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_name, created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
        CREATE INDEX IF NOT EXISTS idx_messages_delivered ON messages(recipient_id, delivered) WHERE delivered = false;
      `);
      
      console.log("✅ Messages table created with indexes");
    } else {
      // Check if room_name column exists, add if not
      const columnCheck = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name IN ('room_name', 'delivered');
      `);

      const existingColumns = columnCheck.rows.map(r => r.column_name);

      if (!existingColumns.includes('room_name')) {
        console.log("Adding room_name column...");
        await db.query(`
          ALTER TABLE messages ADD COLUMN room_name VARCHAR(255) NOT NULL DEFAULT 'general';
          CREATE INDEX idx_messages_room ON messages(room_name, created_at);
        `);
        console.log("✅ Added room support to existing table");
      }

      if (!existingColumns.includes('delivered')) {
        console.log("Adding delivered column for offline messages...");
        await db.query(`
          ALTER TABLE messages ADD COLUMN delivered BOOLEAN DEFAULT false;
          CREATE INDEX idx_messages_delivered ON messages(recipient_id, delivered) WHERE delivered = false;
        `);
        console.log("✅ Added offline message support");
      }

      if (existingColumns.includes('room_name') && existingColumns.includes('delivered')) {
        console.log("✅ Messages table exists with room and offline message support");
      }
    }
    
  } catch (err) {
    console.error("❌ Database test failed:", err);
    process.exit(1);
  }
}

const server = Bun.serve({
  port: 3000,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade at /chat
    if (url.pathname === "/chat") {
      if (server.upgrade(req)) return;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // REST API Endpoints

    // GET /rooms - List all active rooms
    if (url.pathname === "/rooms" && req.method === "GET") {
      try {
        const roomList = await getRoomList();
        return new Response(JSON.stringify({ success: true, rooms: roomList }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // GET /messages?room=roomName - Get messages for a room
    if (url.pathname === "/messages" && req.method === "GET") {
      try {
        const roomName = url.searchParams.get("room") || "general";
        const limit = parseInt(url.searchParams.get("limit") || "50");
        const msgs = await getMessages(roomName, limit);
        return new Response(JSON.stringify({ success: true, room: roomName, messages: msgs }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // POST /message - Send message to room
    if (url.pathname === "/message" && req.method === "POST") {
      try {
        const body = await req.json();
        console.log("📨 POST BODY:", body);
        
        const username = String(body.username || "Anonymous");
        const content = String(body.content || "").trim();
        const roomName = String(body.room || "general");
        
        if (!content) {
          return new Response(
            JSON.stringify({ success: false, error: "content required" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        const savedMsg = await saveMessage(username, content, roomName);

        // Broadcast to room subscribers
        broadcastToRoom(roomName, {
          type: "message",
          ...savedMsg
        });

        return new Response(
          JSON.stringify({ success: true, message: savedMsg }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("❌ POST /message error:", err);
        return new Response(
          JSON.stringify({ success: false, error: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // GET /users?room=roomName - Get online users in a room
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

    return new Response("Bun Chat Server with Pub/Sub. WebSocket: /chat", { status: 200 });
  },

  websocket: {
    async open(ws) {
      console.log("🔌 New WebSocket connection");
    },

    async message(ws, msg) {
      let data;
      try { 
        data = JSON.parse(msg.toString()); 
      } catch { 
        console.warn("⚠️ Invalid JSON");
        return; 
      }

      console.log("📩 WS message:", data.type);

      // JOIN - Subscribe to a room
      if (data.type === "join") {
        const username = String(data.username || "Anonymous");
        const roomName = String(data.room || "general");
        const userId = String(data.userId || Date.now());

        clientData.set(ws, { username, userId });
        userIdToSocket.set(userId, ws); // Register for DMs
        joinRoom(ws, roomName, username);

        // Send room history
        try {
          const history = await getMessages(roomName);
          const users = await getOnlineUsers(roomName);
          
          // Get pending DMs (offline messages)
          const pendingDMs = await getPendingDMs(userId);
          
          ws.send(JSON.stringify({ 
            type: "joined", 
            room: roomName,
            history, 
            users,
            userId,
            pendingDMs: pendingDMs.length,
            timestamp: new Date().toISOString()
          }));

          // Deliver pending DMs
          if (pendingDMs.length > 0) {
            console.log(`📬 Delivering ${pendingDMs.length} pending DMs to ${username}`);
            const deliveredIds: number[] = [];

            for (const dm of pendingDMs) {
              ws.send(JSON.stringify({
                type: "dm",
                from: dm.username,
                fromUsername: dm.username,
                content: dm.content,
                id: dm.id,
                created_at: dm.created_at,
                offline: true // Flag that this was delivered after being offline
              }));
              deliveredIds.push(dm.id);
            }

            // Mark as delivered
            await markDMsAsDelivered(deliveredIds);
          }
        } catch (err) {
          console.error("Error sending history:", err);
        }
      }

      // LEAVE - Unsubscribe from a room
      else if (data.type === "leave") {
        const roomName = String(data.room || "general");
        leaveRoom(ws, roomName);
        ws.send(JSON.stringify({ type: "left", room: roomName }));
      }

      // MESSAGE - Send message to room
      else if (data.type === "message") {
        const userData = clientData.get(ws);
        const username = userData?.username || "Anonymous";
        const content = String(data.content || "").trim();
        const roomName = String(data.room || "general");
        
        if (!content) return;

        try {
          const savedMsg = await saveMessage(username, content, roomName, "room");
          broadcastToRoom(roomName, {
            type: "message",
            ...savedMsg
          });
        } catch (err) {
          console.error("❌ Error processing message:", err);
          ws.send(JSON.stringify({ type: "error", message: "Failed to save message" }));
        }
      }

      // DM - Direct message to a single user
      else if (data.type === "dm") {
        const userData = clientData.get(ws);
        if (!userData) {
          console.error("❌ DM failed: User not authenticated. Must JOIN first!");
          ws.send(JSON.stringify({ 
            type: "error", 
            message: "Not authenticated. Please send 'join' message first with username and userId" 
          }));
          return;
        }

        const username = userData.username;
        const recipientId = String(data.recipientId || "");
        const content = String(data.content || "").trim();

        if (!recipientId || !content) {
          ws.send(JSON.stringify({ type: "error", message: "recipientId and content required" }));
          return;
        }

        const recipientSocket = userIdToSocket.get(recipientId);
        
        try {
          const savedMsg = await saveMessage(username, content, "dm", "dm", recipientId);
          
          if (!recipientSocket) {
            // User is OFFLINE - save for later delivery
            console.log(`📭 User ${recipientId} is offline. Message saved for later delivery.`);
            
            // Queue in RabbitMQ if available
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
              message: "Message saved. Will be delivered when user comes online.",
              queueMethod: useRabbitMQ ? "rabbitmq" : "database",
              ...savedMsg
            }));
            return;
          }

          // User is ONLINE - deliver immediately
          recipientSocket.send(JSON.stringify({
            type: "dm",
            from: userData.userId,
            fromUsername: username,
            ...savedMsg
          }));

          // Mark as delivered immediately
          await markDMsAsDelivered([savedMsg.id]);

          // Confirm to sender
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

      // GROUP_MESSAGE - Send to multiple specific users
      else if (data.type === "group_message") {
        const userData = clientData.get(ws);
        if (!userData) {
          console.error("❌ Group message failed: User not authenticated. Must JOIN first!");
          ws.send(JSON.stringify({ 
            type: "error", 
            message: "Not authenticated. Please send 'join' message first with username and userId" 
          }));
          return;
        }

        const username = userData.username;
        const recipientIds: string[] = data.recipientIds || [];
        const content = String(data.content || "").trim();
        const groupName = String(data.groupName || "private-group");

        if (recipientIds.length === 0 || !content) {
          ws.send(JSON.stringify({ type: "error", message: "recipientIds and content required" }));
          return;
        }

        try {
          const savedMsg = await saveMessage(username, content, groupName, "group", recipientIds.join(","));
          
          let sentCount = 0;
          const failedRecipients: string[] = [];
          const offlineRecipients: string[] = [];

          // Send to each recipient
          for (const recipientId of recipientIds) {
            const recipientSocket = userIdToSocket.get(recipientId);
            if (recipientSocket) {
              // User is ONLINE - deliver immediately
              recipientSocket.send(JSON.stringify({
                type: "group_message",
                from: userData.userId,
                fromUsername: username,
                groupName,
                recipientIds,
                ...savedMsg
              }));
              sentCount++;
            } else {
              // User is OFFLINE - queue for later
              offlineRecipients.push(recipientId);
              
              if (useRabbitMQ) {
                await messageQueue.queueOfflineMessage({
                  recipientId,
                  from: userData.userId,
                  fromUsername: username,
                  content,
                  messageType: 'group',
                  messageId: savedMsg.id,
                  groupName,
                  recipientIds
                });
              }
              
              console.log(`📭 User ${recipientId} offline. Message queued.`);
            }
          }

          // Confirm to sender
          ws.send(JSON.stringify({
            type: "group_message_sent",
            groupName,
            recipientIds,
            sentCount,
            offlineCount: offlineRecipients.length,
            offlineRecipients,
            failedRecipients,
            queueMethod: useRabbitMQ ? "rabbitmq" : "database",
            ...savedMsg
          }));

          console.log(`👥 Group message from ${username}: ${sentCount} delivered, ${offlineRecipients.length} queued`);
        } catch (err) {
          console.error("❌ Error sending group message:", err);
          ws.send(JSON.stringify({ type: "error", message: "Failed to send group message" }));
        }
      }

      // TYPING - Typing indicator
      else if (data.type === "typing") {
        const userData = clientData.get(ws);
        if (!userData) return;
        
        const roomName = String(data.room || "general");
        const isTyping = Boolean(data.isTyping);
        
        setTyping(roomName, userData.username, isTyping);
      }

      // GET_ROOMS - Request room list
      else if (data.type === "get_rooms") {
        const roomList = await getRoomList();
        ws.send(JSON.stringify({ type: "room_list", rooms: roomList }));
      }

      // GET_USERS - Request users in a room
      else if (data.type === "get_users") {
        const roomName = String(data.room || "general");
        const users = await getOnlineUsers(roomName);
        ws.send(JSON.stringify({ type: "user_list", room: roomName, users }));
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

      // Remove from DM registry
      if (userData) {
        userIdToSocket.delete(userData.userId);
      }

      console.log(`🔌 Disconnected: ${userData?.username || "Unknown"}`);
    },

    error(ws, err) {
      console.error("❌ WS error:", err);
    }
  },
});

// Test database and RabbitMQ before starting
await testDatabase();

// Initialize RabbitMQ (optional - falls back to database if unavailable)
const mqInstance = await initMessageQueue();
useRabbitMQ = mqInstance !== null;

if (useRabbitMQ) {
  console.log("✅ Using RabbitMQ for message queuing");
} else {
  console.log("⚠️ Using database-only mode for offline messages");
}

console.log(`
🚀 Bun Chat Server with Pub/Sub System
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 WebSocket: ws://localhost:${server.port}/chat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REST API Endpoints:
  📋 GET  /rooms                  - List all rooms
  📋 GET  /messages?room=general  - Get room messages
  📨 POST /message                - Send message
  👥 GET  /users?room=general     - Get online users
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WebSocket Events:
  📥 join           - Join a room
  📥 leave          - Leave a room
  📥 message        - Send to room
  📥 dm             - Direct message (1-to-1)
  📥 group_message  - Group message (1-to-many)
  📥 typing         - Typing indicator
  📥 get_rooms      - Request room list
  📥 get_users      - Request user list
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);