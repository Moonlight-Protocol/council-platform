import type { Logger } from "@/utils/logger/index.ts";
import { NETWORK_RPC_SERVER } from "@/config/env.ts";
import { fetchChannelAuthEvents } from "./event-watcher.service.ts";
import type {
  ChannelAuthEvent,
  EventWatcherConfig,
} from "./event-watcher.types.ts";
import { withSpan } from "@/core/tracing.ts";

const DEFAULT_INTERVAL_MS = 30_000;

// When a watcher starts fresh (no saved cursor), it begins polling from
// `currentLedger - LOOKBACK_LEDGERS`. This handles the gap between when a
// council is created and when its watcher actually starts (the watcher
// service polls the DB for new councils on a periodic interval, not
// instantly). Without the lookback, provider_added events emitted in that
// window would be missed.
//
// Stellar ledgers are ~5s, so 12 ledgers ≈ 60s of safety margin.
const LOOKBACK_LEDGERS = 12;

function cursorKvKey(contractId: string): Deno.KvKey {
  return ["event-watcher", contractId, "lastLedger"];
}

export type EventHandler = (event: ChannelAuthEvent) => void | Promise<void>;

interface EventWatcherDeps extends EventWatcherConfig {
  log: Logger;
}

/**
 * EventWatcher polls Stellar RPC for Channel Auth contract events.
 *
 * Unlike provider-platform's watcher (which filters for its own address),
 * council-platform processes ALL events to maintain a complete PP registry.
 */
export class EventWatcher {
  private timeoutId: number | null = null;
  private isRunning = false;
  private lastLedger: number | null = null;
  private config: EventWatcherConfig;
  private handlers: EventHandler[] = [];
  private kv: Deno.Kv | null = null;
  private log: Logger;

  constructor(deps: EventWatcherDeps) {
    const { log, ...config } = deps;
    this.config = { intervalMs: DEFAULT_INTERVAL_MS, ...config };
    this.log = log.scope("EventWatcher");
  }

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.log.event("EventWatcher is already running");
      return;
    }

    this.isRunning = true;

    await Deno.mkdir(".data", { recursive: true });
    this.kv = await Deno.openKv("./.data/memory-kvdb.db");

    const stored = await this.kv.get<number>(
      cursorKvKey(this.config.contractId),
    );
    if (stored.value !== null) {
      this.lastLedger = stored.value;
      this.log.debug("contractId", this.config.contractId);
      this.log.debug("startLedger", this.lastLedger);
      this.log.event("EventWatcher restored cursor from KV");
    } else {
      const latestLedger = await NETWORK_RPC_SERVER.getLatestLedger();
      this.lastLedger = Math.max(0, latestLedger.sequence - LOOKBACK_LEDGERS);
      this.log.debug("contractId", this.config.contractId);
      this.log.debug("latestLedger", latestLedger.sequence);
      this.log.debug("startLedger", this.lastLedger);
      this.log.event("EventWatcher initialized from network (no saved cursor)");
    }

    this.scheduleNext();
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.kv) {
      this.kv.close();
      this.kv = null;
    }
    this.log.event("EventWatcher stopped");
  }

  getLastLedger(): number | null {
    return this.lastLedger;
  }

  private async scheduleNext(): Promise<void> {
    this.log.info("scheduleNext");
    await this.poll();
    if (this.isRunning) {
      this.timeoutId = setTimeout(
        () => this.scheduleNext(),
        this.config.intervalMs,
      ) as unknown as number;
      this.log.event("next poll scheduled");
    }
  }

  private poll(): Promise<void> {
    return withSpan("EventWatcher.poll", async (span) => {
      try {
        if (this.lastLedger === null || !this.isRunning) return;

        const { events, latestLedger } = await fetchChannelAuthEvents(
          NETWORK_RPC_SERVER,
          this.config.contractId,
          this.lastLedger,
          { log: this.log },
        );

        if (events.length > 0) {
          span.addEvent("dispatching_events", {
            "events.count": events.length,
          });
          this.log.debug("count", events.length);
          this.log.debug("types", events.map((e) => e.type).join(", "));
          this.log.event(`EventWatcher found ${events.length} new event(s)`);

          for (const event of events) {
            await this.dispatch(event);
          }
        }

        this.lastLedger = latestLedger + 1;

        if (this.kv) {
          await this.kv.set(
            cursorKvKey(this.config.contractId),
            this.lastLedger,
          );
        }
      } catch (error) {
        span.addEvent("poll_error", {
          "error.message": error instanceof Error
            ? error.message
            : String(error),
        });
        this.log.error(error, "EventWatcher poll error");
      }
    });
  }

  private async dispatch(event: ChannelAuthEvent): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch (error) {
        this.log.debug("eventType", event.type);
        this.log.error(error, "EventWatcher handler error");
      }
    }
  }
}
