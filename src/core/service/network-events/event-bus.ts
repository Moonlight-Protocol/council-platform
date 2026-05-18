import type { NetworkEventFrame } from "./types.ts";

type Listener = (event: NetworkEventFrame) => void;

/**
 * In-process pub/sub for the public network-dashboard event stream.
 *
 * Single instance per process. Multi-instance fanout would need Postgres
 * LISTEN/NOTIFY (or similar) — council-platform is single-instance per env
 * (confirmed by PM via env-registry audit), so the in-process bus is
 * sufficient for v1.
 */
class NetworkEventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: NetworkEventFrame): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // A misbehaving listener must not break the publish loop.
        console.warn("[network-event-bus] listener threw:", err);
      }
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

export const networkEventBus = new NetworkEventBus();
