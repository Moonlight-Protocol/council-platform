import { LOG } from "@/config/logger.ts";
import { CHANNEL_AUTH_ID, NETWORK_RPC_SERVER } from "@/config/env.ts";
import { fetchChannelAuthEvents } from "./event-watcher.service.ts";
import type { ChannelAuthEvent, EventWatcherConfig } from "./event-watcher.types.ts";
import { withSpan } from "@/core/tracing.ts";

const DEFAULT_CONFIG: EventWatcherConfig = {
  contractId: CHANNEL_AUTH_ID,
  intervalMs: 30_000,
};

const CURSOR_KV_KEY = ["event-watcher", "lastLedger"];

export type EventHandler = (event: ChannelAuthEvent) => void | Promise<void>;

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

  constructor(config?: Partial<EventWatcherConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      LOG.warn("EventWatcher is already running");
      return;
    }

    this.isRunning = true;

    await Deno.mkdir(".data", { recursive: true });
    this.kv = await Deno.openKv("./.data/memory-kvdb.db");

    const stored = await this.kv.get<number>(CURSOR_KV_KEY);
    if (stored.value !== null) {
      this.lastLedger = stored.value;
      LOG.info("EventWatcher restored cursor from KV", {
        contractId: this.config.contractId,
        startLedger: this.lastLedger,
      });
    } else {
      const latestLedger = await NETWORK_RPC_SERVER.getLatestLedger();
      this.lastLedger = latestLedger.sequence;
      LOG.info("EventWatcher initialized from network (no saved cursor)", {
        contractId: this.config.contractId,
        startLedger: this.lastLedger,
      });
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
    LOG.info("EventWatcher stopped");
  }

  getLastLedger(): number | null {
    return this.lastLedger;
  }

  private async scheduleNext(): Promise<void> {
    await this.poll();
    if (this.isRunning) {
      this.timeoutId = setTimeout(
        () => this.scheduleNext(),
        this.config.intervalMs,
      ) as unknown as number;
    }
  }

  private async poll(): Promise<void> {
    return withSpan("EventWatcher.poll", async (span) => {
      try {
        if (this.lastLedger === null || !this.isRunning) return;

        const { events, latestLedger } = await fetchChannelAuthEvents(
          NETWORK_RPC_SERVER,
          this.config.contractId,
          this.lastLedger,
        );

        if (events.length > 0) {
          span.addEvent("dispatching_events", { "events.count": events.length });
          LOG.info(`EventWatcher found ${events.length} new event(s)`, {
            types: events.map((e) => e.type).join(", "),
          });

          for (const event of events) {
            await this.dispatch(event);
          }
        }

        this.lastLedger = latestLedger + 1;

        if (this.kv) {
          await this.kv.set(CURSOR_KV_KEY, this.lastLedger);
        }
      } catch (error) {
        span.addEvent("poll_error", {
          "error.message": error instanceof Error ? error.message : String(error),
        });
        LOG.error("EventWatcher poll error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private async dispatch(event: ChannelAuthEvent): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch (error) {
        LOG.error("EventWatcher handler error", {
          eventType: event.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
