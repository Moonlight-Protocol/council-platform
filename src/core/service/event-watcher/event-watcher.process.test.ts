import { assertEquals } from "@std/assert";
import { Address, Keypair, xdr } from "stellar-sdk";
import type { Server } from "stellar-sdk/rpc";
import { EventWatcher } from "./event-watcher.process.ts";
import type { ChannelAuthEvent } from "./event-watcher.types.ts";
import { newNoop } from "@/utils/logger/index.ts";

const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";

// Let the fire-and-forget first poll (scheduled by start()) run to completion.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Raw RPC contract event shape that fetchChannelAuthEvents knows how to parse. */
function rawProviderAddedEvent(address: string, ledger: number) {
  return {
    type: "contract" as const,
    ledger,
    topic: [
      xdr.ScVal.scvSymbol("provider_added"),
      new Address(address).toScVal(),
    ],
    value: xdr.ScVal.scvVoid(),
    id: `${ledger}-0`,
    pagingToken: `${ledger}-0`,
    inSuccessfulContractCall: true,
    contractId: CONTRACT,
  };
}

/**
 * Records each getEvents `startLedger`. `rawEvents`/`latestLedger` control what
 * a poll returns (raw events, as the RPC would return them).
 */
function mockRpc(opts: {
  oldestLedger: number;
  latestLedger: number;
  rawEvents?: ReturnType<typeof rawProviderAddedEvent>[];
}) {
  const startLedgers: number[] = [];
  const rpc = {
    // deno-lint-ignore require-await -- mock satisfies async getHealth contract
    getHealth: async () => ({ oldestLedger: opts.oldestLedger }),
    // deno-lint-ignore require-await -- mock satisfies async getEvents contract
    getEvents: async (req: { startLedger: number }) => {
      startLedgers.push(req.startLedger);
      return { events: opts.rawEvents ?? [], latestLedger: opts.latestLedger };
    },
  } as unknown as Server;
  return { rpc, startLedgers };
}

Deno.test("EventWatcher - restores cursor from Postgres → resumes at stored ledger", async () => {
  const { rpc, startLedgers } = mockRpc({
    oldestLedger: 5000,
    latestLedger: 9100,
  });
  const watcher = new EventWatcher({
    contractId: CONTRACT,
    intervalMs: 60_000,
    log: newNoop(),
    rpc,
    startLedgerBlock: null,
    restoreCursor: () => Promise.resolve(9001), // durable cursor present
    commit: () => Promise.resolve(),
  });

  await watcher.start();
  watcher.stop();

  // Resumes from Postgres, NOT from oldest available and NOT from latest.
  assertEquals(startLedgers[0], 9001);
});

Deno.test("EventWatcher - no cursor + override set → first getEvents at that ledger", async () => {
  const { rpc, startLedgers } = mockRpc({
    oldestLedger: 5000,
    latestLedger: 9100,
  });
  const watcher = new EventWatcher({
    contractId: CONTRACT,
    intervalMs: 60_000,
    log: newNoop(),
    rpc,
    startLedgerBlock: 12345,
    restoreCursor: () => Promise.resolve(null),
    commit: () => Promise.resolve(),
  });

  await watcher.start();
  watcher.stop();

  assertEquals(startLedgers[0], 12345);
});

Deno.test("EventWatcher - no cursor + override unset → first getEvents at oldest available", async () => {
  const { rpc, startLedgers } = mockRpc({
    oldestLedger: 5000,
    latestLedger: 9100,
  });
  const watcher = new EventWatcher({
    contractId: CONTRACT,
    intervalMs: 60_000,
    log: newNoop(),
    rpc,
    startLedgerBlock: null,
    restoreCursor: () => Promise.resolve(null),
    commit: () => Promise.resolve(),
  });

  await watcher.start();
  watcher.stop();

  assertEquals(startLedgers[0], 5000);
});

Deno.test("EventWatcher - commit receives the poll's events and next ledger; cursor advances only after it resolves", async () => {
  const addr = Keypair.random().publicKey();
  const { rpc } = mockRpc({
    oldestLedger: 5000,
    latestLedger: 9100,
    rawEvents: [rawProviderAddedEvent(addr, 9050)],
  });
  const commits: Array<{ events: ChannelAuthEvent[]; nextLedger: number }> = [];

  const watcher = new EventWatcher({
    contractId: CONTRACT,
    intervalMs: 60_000,
    log: newNoop(),
    rpc,
    startLedgerBlock: null,
    restoreCursor: () => Promise.resolve(9001),
    commit: (events, nextLedger) => {
      commits.push({ events, nextLedger });
      return Promise.resolve();
    },
  });

  await watcher.start();
  await tick();
  watcher.stop();

  assertEquals(commits.length, 1);
  // The poll forwards the parsed events to commit.
  assertEquals(commits[0].events.length, 1);
  assertEquals(commits[0].events[0].type, "provider_added");
  assertEquals(commits[0].events[0].address, addr);
  assertEquals(commits[0].events[0].ledger, 9050);
  assertEquals(commits[0].nextLedger, 9101); // latestLedger + 1
  assertEquals(watcher.getLastLedger(), 9101); // advanced only after commit
});

Deno.test("EventWatcher - commit failure does NOT advance the cursor (range is retried)", async () => {
  const { rpc } = mockRpc({ oldestLedger: 5000, latestLedger: 9100 });

  const watcher = new EventWatcher({
    contractId: CONTRACT,
    intervalMs: 60_000,
    log: newNoop(),
    rpc,
    startLedgerBlock: null,
    restoreCursor: () => Promise.resolve(9001),
    commit: () => Promise.reject(new Error("tx rolled back")),
  });

  await watcher.start();
  await tick();
  watcher.stop();

  // The commit threw, so the in-memory cursor stays at the un-committed start —
  // the same ledger range will be re-fetched and re-applied next poll.
  assertEquals(watcher.getLastLedger(), 9001);
});
