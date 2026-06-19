import type { Logger } from "@/utils/logger/index.ts";
import type { Server } from "stellar-sdk/rpc";
import { fetchChannelAuthEvents } from "./event-watcher.service.ts";
import type {
  ChannelAuthEvent,
  EventWatcherConfig,
} from "./event-watcher.types.ts";
import { withSpan } from "@/core/tracing.ts";
import { resolveBootStartLedger } from "./start-ledger.ts";

const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Applies the events of a single poll AND advances the cursor as one atomic
 * unit. The watcher only treats a poll as done — and only advances its in-memory
 * position — once this resolves, so the Postgres state and the cursor can never
 * diverge: a crash mid-commit rolls back both and the same ledger range is
 * re-fetched and re-applied (idempotently) on the next poll.
 */
export type CommitPoll = (
  events: ChannelAuthEvent[],
  nextLedger: number,
) => Promise<void>;

/** Restore this council's persisted cursor, or null if none is stored yet. */
export type RestoreCursor = () => Promise<number | null>;

export interface EventWatcherDeps extends EventWatcherConfig {
  log: Logger;
  rpc: Server;
  startLedgerBlock: number | null;
  restoreCursor: RestoreCursor;
  commit: CommitPoll;
}

/**
 * EventWatcher polls Stellar RPC for Channel Auth contract events.
 *
 * council-platform is the event-only root source of channel state, so it keeps a
 * durable cursor — but in Postgres, advanced atomically with the status writes
 * each poll produces (see `commit`). On a fresh boot with no stored cursor it
 * syncs all available history from the resolved boot ledger
 * (see `resolveBootStartLedger`).
 */
export class EventWatcher {
  private timeoutId: number | null = null;
  private isRunning = false;
  private lastLedger: number | null = null;
  private config: EventWatcherConfig;
  private rpc: Server;
  private startLedgerBlock: number | null;
  private restoreCursor: RestoreCursor;
  private commit: CommitPoll;
  private log: Logger;

  constructor(deps: EventWatcherDeps) {
    const { log, rpc, startLedgerBlock, restoreCursor, commit, ...config } =
      deps;
    this.config = { intervalMs: DEFAULT_INTERVAL_MS, ...config };
    this.rpc = rpc;
    this.startLedgerBlock = startLedgerBlock;
    this.restoreCursor = restoreCursor;
    this.commit = commit;
    this.log = log.scope("EventWatcher");
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.log.event("EventWatcher is already running");
      return;
    }

    this.isRunning = true;

    // Restore the durable Postgres cursor; if absent, resolve the boot start
    // ledger (oldest available, or the configured override) and sync forward.
    const stored = await this.restoreCursor();
    if (stored !== null) {
      this.lastLedger = stored;
      this.log.debug("contractId", this.config.contractId);
      this.log.debug("startLedger", this.lastLedger);
      this.log.event("EventWatcher restored cursor from Postgres");
    } else {
      this.lastLedger = await resolveBootStartLedger(
        this.rpc,
        this.startLedgerBlock,
      );
      this.log.debug("contractId", this.config.contractId);
      this.log.debug("startLedger", this.lastLedger);
      this.log.event("EventWatcher initialized boot start ledger (no cursor)");
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
          this.rpc,
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
        }

        // Apply the poll's events and advance the cursor atomically. Only on
        // success do we advance our in-memory position — a commit failure leaves
        // lastLedger untouched so the same range is retried next poll.
        const nextLedger = latestLedger + 1;
        await this.commit(events, nextLedger);
        this.lastLedger = nextLedger;
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
}
