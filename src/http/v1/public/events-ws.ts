import type { Context } from "@oak/oak";
import { LOG } from "@/config/logger.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { NetworkEventRepository } from "@/persistence/drizzle/repository/network-event.repository.ts";
import { networkEventBus } from "@/core/service/network-events/event-bus.ts";
import type {
  NetworkEventFrame,
  ServerFrame,
} from "@/core/service/network-events/types.ts";
import type { NetworkEvent } from "@/persistence/drizzle/entity/network-event.entity.ts";

/**
 * WebSocket subprotocol echoed back on a successful upgrade. Versioning
 * anchor — bump to `.v2` if the frame shape ever breaks compatibility.
 */
export const NETWORK_WS_SUBPROTOCOL = "moonlight.network.v1";

const IDLE_TIMEOUT_SECONDS = 30;
const HELLO_FRAME_LIMIT = 50;
const HELLO_WINDOW_MS = 24 * 60 * 60 * 1000;

let repo = new NetworkEventRepository(drizzleClient);

/** Test seam: inject a repo backed by the test DB. */
export function setRepoForTests(testRepo: NetworkEventRepository): void {
  repo = testRepo;
}

function rowToFrame(row: NetworkEvent): NetworkEventFrame {
  return {
    id: row.id,
    kind: row.kind as NetworkEventFrame["kind"],
    councilId: row.councilId,
    ledger: row.ledger,
    occurredAt: row.occurredAt.toISOString(),
    payload: (row.payload ?? {}) as Record<string, unknown>,
  };
}

/**
 * Public WebSocket endpoint for the network-dashboard ticker.
 *
 * Unauthenticated by design — the dashboard at dashboard.moonlightprotocol.io
 * is public, anonymous, aggregate-only. No JWT, no per-PP scoping.
 *
 * Frame protocol:
 *   server → client:
 *     { type: "hello", events: NetworkEventFrame[] }   (sent once on open;
 *       up to 50 events from the 24h retention window, oldest-first)
 *     { type: "event", event: NetworkEventFrame }      (live deltas)
 *
 * No client → server frames in v1 — clients reconnect rather than send pings.
 *
 * Race note: live events emitted between the hello listRecent query and the
 * bus subscription below are not delivered. For the current event cadence
 * (chain-level, sparse) this is acceptable; clients can reconnect to catch
 * up via hello.
 */
export function eventsWsHandler(ctx: Context): void {
  if (!ctx.isUpgradable) {
    ctx.response.status = 426;
    ctx.response.body = { error: "WebSocket upgrade required" };
    return;
  }

  const socket = ctx.upgrade({
    protocol: NETWORK_WS_SUBPROTOCOL,
    idleTimeout: IDLE_TIMEOUT_SECONDS,
  });

  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  const sendFrame = (frame: ServerFrame): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(frame));
    } catch (err) {
      LOG.warn("Failed to send network WS frame", {
        type: frame.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  socket.onopen = () => {
    (async () => {
      try {
        const since = new Date(Date.now() - HELLO_WINDOW_MS);
        const rows = await repo.listRecent({
          since,
          limit: HELLO_FRAME_LIMIT,
        });
        // listRecent returns newest-first; reverse so the client renders
        // oldest-first into the activity feed (newest will land on top
        // once the feed unshifts subsequent live frames).
        const events = rows.map(rowToFrame).reverse();
        sendFrame({ type: "hello", events });
      } catch (err) {
        LOG.warn("Failed to build network WS hello frame", {
          error: err instanceof Error ? err.message : String(err),
        });
        sendFrame({ type: "hello", events: [] });
      }

      unsubscribe = networkEventBus.subscribe((event) => {
        sendFrame({ type: "event", event });
      });

      LOG.info("Network events WS opened", {
        subscribers: networkEventBus.listenerCount(),
      });
    })();
  };

  socket.onclose = () => {
    cleanup();
    LOG.info("Network events WS closed");
  };

  socket.onerror = (event) => {
    LOG.warn("Network events WS error", {
      message: event instanceof ErrorEvent ? event.message : "unknown",
    });
    cleanup();
  };
}
