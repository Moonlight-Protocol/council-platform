import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/persistence/drizzle/entity/index.ts";
import { DATABASE_URL } from "@/config/env.ts";

const client = postgres(DATABASE_URL);

const drizzleClient = drizzle({ client, schema });

export type DrizzleClient = typeof drizzleClient;

/**
 * The transaction handle drizzle hands to a `db.transaction(tx => ...)`
 * callback. It exposes the same query builders as the client, so repositories
 * can run either against the connection pool or inside a transaction.
 */
export type DrizzleTransaction = Parameters<
  Parameters<DrizzleClient["transaction"]>[0]
>[0];

/** A repository can be bound to the pool or to an open transaction. */
export type DbOrTx = DrizzleClient | DrizzleTransaction;

export { drizzleClient };
