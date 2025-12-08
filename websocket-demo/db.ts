import { Pool } from "pg";

export const db = new Pool({
  user: "postgres",
  password: "Rapidfire@123",  // No encoding needed!
  host: "localhost",
  port: 5432,
  database: "bun_chat",
});