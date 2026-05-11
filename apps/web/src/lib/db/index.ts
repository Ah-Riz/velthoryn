import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

const client = postgres(
  connectionString ?? "postgresql://unconfigured:unconfigured@localhost:1/unconfigured",
  {
    max: 1,
    idle_timeout: connectionString ? 20 : 1,
    connect_timeout: connectionString ? 10 : 1,
  },
);

export const db = drizzle(client, { schema });

export type Database = typeof db;
