import {
  BOOT_SYNC_START_LEDGER_BLOCK,
  CHALLENGE_TTL,
  NETWORK_RPC_SERVER,
} from "@/config/env.ts";
import { type CommitPoll, EventWatcher } from "./event-watcher.process.ts";
import { setChallengeTtlMs } from "@/core/service/auth/council-auth.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { WatcherCursorRepository } from "@/persistence/drizzle/repository/watcher-cursor.repository.ts";
import { applyEvent } from "./apply-event.ts";

// Wire env CHALLENGE_TTL (seconds) to council auth (ms)
setChallengeTtlMs(CHALLENGE_TTL * 1000);

const metadataRepo = new CouncilMetadataRepository(drizzleClient);

/**
 * Multi-council event watcher.
 *
 * Each council's `id` IS the channel auth contract ID. The service polls the
 * DB periodically for councils that don't yet have a watcher and starts one.
 * Per-council watchers are persistent and hold a durable Postgres cursor,
 * advanced atomically with each poll's writes.
 *
 * Events update the council tables for the corresponding council:
 *   - provider_added → upsert ACTIVE provider for that council
 *   - provider_removed → mark provider REMOVED for that council
 *   - channel_state_changed → reconcile council_channels.status from chain
 *
 * Design note: handlers DO NOT trigger watcher creation directly. They only
 * write to the DB; the watcher service picks up the new council on its next
 * sync tick. This keeps handlers free of async side effects.
 */

const DB_SYNC_INTERVAL_MS = 5_000;

const activeWatchers = new Map<string, EventWatcher>(); // councilId → watcher
let dbSyncTimer: number | null = null;

/**
 * Build the atomic commit for a council's watcher: apply every event of a poll
 * and advance the cursor in ONE transaction. A failure rolls back both the
 * status writes and the cursor advance.
 */
function makeCommit(councilId: string, log: Logger): CommitPoll {
  return (events, nextLedger) =>
    drizzleClient.transaction(async (tx) => {
      const providerRepo = new CouncilProviderRepository(tx);
      const channelRepo = new CouncilChannelRepository(tx);
      const cursorRepo = new WatcherCursorRepository(tx);
      for (const event of events) {
        await applyEvent(councilId, event, { providerRepo, channelRepo }, log);
      }
      await cursorRepo.upsert(councilId, nextLedger);
    });
}

async function ensureWatcher(
  councilId: string,
  deps: { log: Logger },
): Promise<void> {
  if (activeWatchers.has(councilId)) return;

  const log = deps.log.scope("eventWatcher");
  const watcher = new EventWatcher({
    contractId: councilId,
    log: deps.log,
    rpc: NETWORK_RPC_SERVER,
    startLedgerBlock: BOOT_SYNC_START_LEDGER_BLOCK,
    restoreCursor: () =>
      new WatcherCursorRepository(drizzleClient).get(councilId),
    commit: makeCommit(councilId, log),
  });

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
