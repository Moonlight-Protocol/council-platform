// deno-lint-ignore-file no-explicit-any
/**
 * PGlite-backed test database for integration tests.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) with Drizzle ORM,
 * giving us real SQL, real transactions, and real constraints
 * without needing an external PostgreSQL server.
 *
 * Schema is built by running migration SQL files in order — the same
 * files that run in production. No separate schema copy to keep in sync.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/persistence/drizzle/entity/index.ts";

const MIGRATIONS_DIR = new URL(
  "../src/persistence/drizzle/migration/",
  import.meta.url,
).pathname;

/** Read the migration journal and execute each SQL file in order. */
async function runMigrations(pg: PGlite): Promise<void> {
  const journal = JSON.parse(
    await Deno.readTextFile(`${MIGRATIONS_DIR}meta/_journal.json`),
  );
  for (const entry of journal.entries) {
    const sql = await Deno.readTextFile(`${MIGRATIONS_DIR}${entry.tag}.sql`);
    await pg.exec(sql);
  }
}

type PGliteDrizzle = ReturnType<typeof drizzle<typeof schema>>;

let pg: PGlite;
let _drizzleClient: PGliteDrizzle;
let _initialized = false;

async function ensureInitialized() {
  if (_initialized) return;

  pg = new PGlite();
  await runMigrations(pg);

  _drizzleClient = drizzle({ client: pg, schema });
  _initialized = true;
}

// Lazy proxy so modules that import drizzleClient at load time work correctly.
const drizzleClientProxy: PGliteDrizzle = new Proxy({} as PGliteDrizzle, {
  get(_target, prop) {
    if (!_initialized) {
      throw new Error(
        "PGlite not initialized. Call ensureInitialized() before using drizzleClient.",
      );
    }
    const val = (_drizzleClient as any)[prop];
    return typeof val === "function" ? val.bind(_drizzleClient) : val;
  },
});

export const drizzleClient = drizzleClientProxy;
export type DrizzleClient = PGliteDrizzle;

export { ensureInitialized };

/**
 * Truncate all tables. Call between tests for a clean slate.
 */
export async function resetDb(): Promise<void> {
  await ensureInitialized();
  await pg.exec(`
    TRUNCATE TABLE
      council_escrows,
      custodial_users,
      provider_join_requests,
      council_providers,
      council_channels,
      council_jurisdictions,
      council_metadata,
      known_assets,
      wallet_users
    CASCADE;
  `);
}

/**
 * Shut down PGlite. Call after all tests are done.
 */
export async function closeDb(): Promise<void> {
  if (_initialized) {
    await pg.close();
    _initialized = false;
  }
}
