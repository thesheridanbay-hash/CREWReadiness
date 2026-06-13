import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";

/**
 * WebSocket Pool driver (D20): the HTTP driver cannot run interactive
 * transactions, and the scoped layer (lib/db/scoped.ts) depends on
 * transaction-wrapped `SET LOCAL app.company_id`. Node 22+ provides a global
 * WebSocket; no extra dependency needed.
 *
 * IMPORTANT: do not query this instance directly from feature code — go
 * through scoped()/scopedForJob() so every statement runs inside a tenant
 * context. Direct use is reserved for the scoped layer itself and
 * infrastructure (migrations, seeds, health checks).
 */
neonConfig.webSocketConstructor = globalThis.WebSocket;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const db = drizzle(pool, { schema });

export type Db = typeof db;

export default db;
