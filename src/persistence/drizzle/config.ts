import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/persistence/drizzle/entity/index.ts";
import { DATABASE_URL } from "@/config/env.ts";

const client = postgres(DATABASE_URL);

const drizzleClient = drizzle({ client, schema });

export type DrizzleClient = typeof drizzleClient;
export { drizzleClient };
