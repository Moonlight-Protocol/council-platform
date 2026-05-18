import { LOG } from "@/config/logger.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { NetworkEventRepository } from "@/persistence/drizzle/repository/network-event.repository.ts";

/** 24h rolling window — matches the EVENTS/24H counter contract. */
const RETENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How often the purge loop runs. Operational knob; not env-configurable yet. */
const PURGE_INTERVAL_MS = 10 * 60 * 1000;

let repo = new NetworkEventRepository(drizzleClient);
let timeoutId: number | null = null;
let isRunning = false;

/** Test seam: inject a repo backed by the test DB. */
export function setRepoForTests(testRepo: NetworkEventRepository): void {
  repo = testRepo;
}

async function purge(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RETENTION_WINDOW_MS);
    const deleted = await repo.purgeOlderThan(cutoff);
    if (deleted > 0) {
      LOG.info("network_events retention purged rows", {
        deleted,
        cutoff: cutoff.toISOString(),
      });
    }
  } catch (error) {
    LOG.error("network_events retention purge failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function scheduleNext(): Promise<void> {
  await purge();
  if (isRunning) {
    timeoutId = setTimeout(
      () => scheduleNext(),
      PURGE_INTERVAL_MS,
    ) as unknown as number;
  }
}

export async function startNetworkEventsRetention(): Promise<void> {
  if (isRunning) {
    LOG.warn("network_events retention already running");
    return;
  }
  isRunning = true;
  LOG.info("network_events retention started", {
    windowMs: RETENTION_WINDOW_MS,
    intervalMs: PURGE_INTERVAL_MS,
  });
  await scheduleNext();
}

export function stopNetworkEventsRetention(): void {
  if (!isRunning) return;
  isRunning = false;
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  LOG.info("network_events retention stopped");
}
