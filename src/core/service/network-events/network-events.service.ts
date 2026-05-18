import { LOG } from "@/config/logger.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { NetworkEventRepository } from "@/persistence/drizzle/repository/network-event.repository.ts";
import type { NewNetworkEvent } from "@/persistence/drizzle/entity/network-event.entity.ts";
import { networkEventBus } from "./event-bus.ts";
import type { NetworkEventFrame } from "./types.ts";

let repo = new NetworkEventRepository(drizzleClient);

/** Test seam: inject a repo backed by the test DB. */
export function setRepoForTests(testRepo: NetworkEventRepository): void {
  repo = testRepo;
}

/**
 * Persist a network event row and broadcast it to all WS subscribers.
 *
 * DB write happens first so a publish-only delivery never claims to be
 * recorded. If the DB write fails, no frame is broadcast and the error
 * propagates to the caller (which can log and drop on the floor — the
 * ticker is not authoritative).
 */
export async function recordAndPublishNetworkEvent(
  input: NewNetworkEvent,
): Promise<NetworkEventFrame> {
  const stored = await repo.insertOne(input);
  const frame: NetworkEventFrame = {
    id: stored.id,
    kind: stored.kind as NetworkEventFrame["kind"],
    councilId: stored.councilId,
    ledger: stored.ledger,
    occurredAt: stored.occurredAt.toISOString(),
    payload: (stored.payload ?? {}) as Record<string, unknown>,
  };
  networkEventBus.publish(frame);
  LOG.info("network_event recorded + published", {
    kind: frame.kind,
    councilId: frame.councilId,
  });
  return frame;
}
