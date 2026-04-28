/**
 * Integration tests for CouncilJurisdictionRepository.
 *
 * Run with: deno test --allow-all --config tests/deno.json tests/integration/repository/council-jurisdiction.repository.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { CouncilJurisdictionRepository } from "@/persistence/drizzle/repository/council-jurisdiction.repository.ts";
import {
  drizzleClient,
  ensureInitialized,
  resetDb,
  seedJurisdiction,
} from "../../test_helpers.ts";

const repo = new CouncilJurisdictionRepository(drizzleClient);

Deno.test("create - inserts a jurisdiction", async () => {
  await ensureInitialized();
  await resetDb();

  const result = await repo.create({
    id: crypto.randomUUID(),
    councilId: "default",
    countryCode: "US",
    label: "United States",
  });

  assertEquals(result.countryCode, "US");
  assertEquals(result.label, "United States");
});

Deno.test("findByCountryCode - returns the correct record", async () => {
  await ensureInitialized();
  await resetDb();

  await seedJurisdiction({ countryCode: "GB", label: "United Kingdom" });

  const found = await repo.findByCountryCode("default", "GB");
  assertExists(found);
  assertEquals(found.countryCode, "GB");
});

Deno.test("findByCountryCode - returns undefined for non-existent", async () => {
  await ensureInitialized();
  await resetDb();

  const found = await repo.findByCountryCode("default", "ZZ");
  assertEquals(found, undefined);
});

Deno.test("listAll - returns all non-deleted jurisdictions ordered by country code", async () => {
  await ensureInitialized();
  await resetDb();

  await seedJurisdiction({ countryCode: "US", label: "United States" });
  await seedJurisdiction({ countryCode: "GB", label: "United Kingdom" });
  await seedJurisdiction({ countryCode: "DE", label: "Germany" });

  const all = await repo.listAll("default");
  assertEquals(all.length, 3);
  // Should be ordered by country code
  assertEquals(all[0].countryCode, "DE");
  assertEquals(all[1].countryCode, "GB");
  assertEquals(all[2].countryCode, "US");
});

Deno.test("delete - soft-deletes and record excluded from listAll", async () => {
  await ensureInitialized();
  await resetDb();

  const j1 = await seedJurisdiction({ countryCode: "US" });
  await seedJurisdiction({ countryCode: "GB" });

  await repo.delete(j1.id);

  const all = await repo.listAll("default");
  assertEquals(all.length, 1);
  assertEquals(all[0].countryCode, "GB");

  // Also excluded from findByCountryCode
  const found = await repo.findByCountryCode("default", "US");
  assertEquals(found, undefined);
});
