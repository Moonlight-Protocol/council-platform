import { CHALLENGE_TTL } from "@/config/env.ts";
import { EventWatcher } from "./event-watcher.process.ts";
import { setChallengeTtlMs } from "@/core/service/auth/council-auth.ts";
import { LOG } from "@/config/logger.ts";
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
 * Each council's `id` IS the channel auth contract ID. The watcher loads all
 * councils from the DB on startup and creates a per-council watcher. When a
 * new council is created, addCouncilWatcher is called to start watching it.
 *
 * Events update the council_providers table for the corresponding council:
 *   - provider_added → upsert ACTIVE provider for that council
 *   - provider_removed → mark provider REMOVED for that council
 */

const activeWatchers = new Map<string, EventWatcher>(); // councilId → watcher

function makeHandler(councilId: string) {
  return async (event: { type: string; address: string; ledger: number }) => {
    switch (event.type) {
      case "provider_added": {
        LOG.info("Provider added on-chain", {
          councilId,
          address: event.address,
          ledger: event.ledger,
        });

        const existing = await providerRepo.findByPublicKey(councilId, event.address);
        if (existing) {
          if (existing.status === ProviderStatus.REMOVED) {
            await providerRepo.update(existing.id, {
              status: ProviderStatus.ACTIVE,
              registeredByEvent: `ledger:${event.ledger}`,
              removedByEvent: null,
            });
            LOG.info("Provider re-activated", { councilId, address: event.address });
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
          LOG.info("Provider registered", { councilId, address: event.address });
        }
        break;
      }

      case "provider_removed": {
        LOG.info("Provider removed on-chain", {
          councilId,
          address: event.address,
          ledger: event.ledger,
        });

        const provider = await providerRepo.findByPublicKey(councilId, event.address);
        if (provider) {
          await providerRepo.update(provider.id, {
            status: ProviderStatus.REMOVED,
            removedByEvent: `ledger:${event.ledger}`,
          });
          LOG.info("Provider marked as removed", { councilId, address: event.address });
        }
        break;
      }

      case "contract_initialized": {
        LOG.info("Channel Auth contract initialized", {
          councilId,
          address: event.address,
          ledger: event.ledger,
        });
        break;
      }
    }
  };
}

async function ensureWatcher(councilId: string): Promise<void> {
  if (activeWatchers.has(councilId)) return;

  const watcher = new EventWatcher({ contractId: councilId });
  watcher.onEvent(makeHandler(councilId));

  try {
    await watcher.start();
  } catch (err) {
    LOG.error("Failed to start event watcher", {
      councilId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  activeWatchers.set(councilId, watcher);
  LOG.info("Started event watcher for council", { councilId });
}

/** Add a council to watch (called when a new council is created via PUT /council/metadata). */
export function addCouncilWatcher(councilId: string): void {
  ensureWatcher(councilId).catch((err) => {
    LOG.error("Failed to add council watcher", {
      councilId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

async function initFromDb(): Promise<void> {
  try {
    const councils = await metadataRepo.listAll();
    for (const council of councils) {
      await ensureWatcher(council.id);
    }
    LOG.info("Event watchers initialized from DB", {
      councils: councils.length,
      watchers: activeWatchers.size,
    });
  } catch (err) {
    LOG.warn("Failed to initialize event watchers from DB", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function startEventWatcher(): Promise<void> {
  await initFromDb();
  if (activeWatchers.size === 0) {
    LOG.info("No councils — no event watchers started");
  }
}

export function stopEventWatcher(): void {
  for (const [, watcher] of activeWatchers) {
    try {
      watcher.stop();
    } catch { /* best effort */ }
  }
  activeWatchers.clear();
}
