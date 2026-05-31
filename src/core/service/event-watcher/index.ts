import { CHALLENGE_TTL } from "@/config/env.ts";
import { EventWatcher } from "./event-watcher.process.ts";
import { setChallengeTtlMs } from "@/core/service/auth/council-auth.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import { ProviderStatus } from "@/persistence/drizzle/entity/council-provider.entity.ts";

// Wire env CHALLENGE_TTL (seconds) to council auth (ms)
setChallengeTtlMs(CHALLENGE_TTL * 1000);

const metadataRepo = new CouncilMetadataRepository(drizzleClient);
const providerRepo = new CouncilProviderRepository(drizzleClient);

/**
 * Multi-council event watcher.
 *
 * Each council's `id` IS the channel auth contract ID. The service polls the
 * DB periodically for councils that don't yet have a watcher and starts one.
 * Per-council watchers are persistent and use a ledger lookback so they don't
 * miss events emitted between council creation and watcher startup.
 *
 * Events update the council_providers table for the corresponding council:
 *   - provider_added → upsert ACTIVE provider for that council
 *   - provider_removed → mark provider REMOVED for that council
 *
 * Design note: handlers (e.g., putMetadataHandler) DO NOT trigger watcher
 * creation directly. They only write to the DB; the watcher service picks up
 * the new council on its next sync tick. This keeps handlers free of async
 * side effects and makes them trivially testable.
 */

const DB_SYNC_INTERVAL_MS = 5_000;

const activeWatchers = new Map<string, EventWatcher>(); // councilId → watcher
let dbSyncTimer: number | null = null;

function makeHandler(councilId: string, log: Logger) {
  return async (event: { type: string; address: string; ledger: number }) => {
    switch (event.type) {
      case "provider_added": {
        log.debug("councilId", councilId);
        log.debug("address", event.address);
        log.debug("ledger", event.ledger);
        log.event("provider added on-chain");

        const existing = await providerRepo.findByPublicKey(
          councilId,
          event.address,
        );
        if (existing) {
          if (existing.status === ProviderStatus.REMOVED) {
            await providerRepo.update(existing.id, {
              status: ProviderStatus.ACTIVE,
              registeredByEvent: `ledger:${event.ledger}`,
              removedByEvent: null,
            });
            log.event("provider re-activated");
          }
        } else {
          await providerRepo.create({
            id: crypto.randomUUID(),
            councilId,
            publicKey: event.address,
            status: ProviderStatus.ACTIVE,
            registeredByEvent: `ledger:${event.ledger}`,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          log.event("provider registered");
        }
        break;
      }

      case "provider_removed": {
        log.debug("councilId", councilId);
        log.debug("address", event.address);
        log.debug("ledger", event.ledger);
        log.event("provider removed on-chain");

        const provider = await providerRepo.findByPublicKey(
          councilId,
          event.address,
        );
        if (provider) {
          await providerRepo.update(provider.id, {
            status: ProviderStatus.REMOVED,
            removedByEvent: `ledger:${event.ledger}`,
          });
          log.event("provider marked as removed");
        }
        break;
      }

      case "contract_initialized": {
        log.debug("councilId", councilId);
        log.debug("address", event.address);
        log.debug("ledger", event.ledger);
        log.event("channel auth contract initialized");
        break;
      }
    }
  };
}

async function ensureWatcher(
  councilId: string,
  deps: { log: Logger },
): Promise<void> {
  if (activeWatchers.has(councilId)) return;

  const log = deps.log.scope("eventWatcher");
  const watcher = new EventWatcher({ contractId: councilId, log: deps.log });
  watcher.onEvent(makeHandler(councilId, log));

  try {
    await watcher.start();
  } catch (err) {
    log.debug("councilId", councilId);
    log.error(err, "failed to start event watcher");
    return;
  }

  activeWatchers.set(councilId, watcher);
  log.debug("councilId", councilId);
  log.event("started event watcher for council");
}

/**
 * Loads all councils from the DB and starts a watcher for any that don't
 * have one yet. Called once at boot and then periodically by startEventWatcher.
 */
async function syncWatchersFromDb(deps: { log: Logger }): Promise<void> {
  const log = deps.log.scope("eventWatcher");
  try {
    const councils = await metadataRepo.listAll();
    for (const council of councils) {
      if (!activeWatchers.has(council.id)) {
        await ensureWatcher(council.id, deps);
      }
    }
  } catch (err) {
    log.error(err, "failed to sync event watchers from DB");
  }
}

export async function startEventWatcher(
  deps: { log: Logger },
): Promise<void> {
  const log = deps.log.scope("eventWatcher");
  await syncWatchersFromDb(deps);
  log.debug("initialWatchers", activeWatchers.size);
  log.debug("syncIntervalMs", DB_SYNC_INTERVAL_MS);
  log.event("event watcher service started");

  // Periodically pick up newly-created councils. Handlers don't notify the
  // watcher directly — they just write to the DB and we discover them here.
  dbSyncTimer = setInterval(() => {
    syncWatchersFromDb(deps).catch((err) => {
      log.error(err, "DB sync tick failed");
    });
  }, DB_SYNC_INTERVAL_MS) as unknown as number;
}

export function stopEventWatcher(): void {
  if (dbSyncTimer !== null) {
    clearInterval(dbSyncTimer);
    dbSyncTimer = null;
  }
  for (const [, watcher] of activeWatchers) {
    try {
      watcher.stop();
    } catch { /* best effort */ }
  }
  activeWatchers.clear();
}
