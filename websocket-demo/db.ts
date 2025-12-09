import { Pool } from "pg";

// Load environment variables
const dbConfig = {
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "bun_chat",
  max: parseInt(process.env.DB_POOL_MAX || "20"),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || "30000"),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || "2000"),
};

if (!dbConfig.password) {
  console.warn("⚠️  DB_PASSWORD not set. Using empty password (not recommended for production)");
}

export const db = new Pool(dbConfig);

// Test connection on startup
db.on("error", (err) => {
  console.error("❌ Unexpected database error:", err);
});

db.on("connect", () => {
  console.log("✅ Database connection established");
});