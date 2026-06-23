import { assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import { applyEvent } from "./apply-event.ts";
import type { ChannelAuthEvent } from "./event-watcher.types.ts";
import type { ProviderRemovedNotice } from "./notify-provider-removed.ts";
import {
  type CouncilProvider,
  ProviderStatus,
} from "@/persistence/drizzle/entity/council-provider.entity.ts";
import type { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import type { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";

const COUNCIL = "CCOUNCIL";
const PROVIDER_PK = "GPROVIDER";

function removedEvent(ledger = 42): ChannelAuthEvent {
  return {
    type: "provider_removed",
    address: PROVIDER_PK,
    ledger,
    contractId: COUNCIL,
  };
}

/** Minimal provider row; only fields applyEvent touches need to be real. */
function providerRow(over: Partial<CouncilProvider>): CouncilProvider {
  return {
    id: "row-1",
    councilId: COUNCIL,
    publicKey: PROVIDER_PK,
    status: ProviderStatus.ACTIVE,
    providerUrl: "https://pp.example.com",
    ...over,
  } as CouncilProvider;
}

/** Fake repo capturing update() calls and returning a fixed provider row. */
function fakeRepos(provider: CouncilProvider | undefined) {
  const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const providerRepo = {
    findByPublicKey: (_c: string, _pk: string) => Promise.resolve(provider),
    update: (id: string, fields: Record<string, unknown>) => {
      updates.push({ id, fields });
      return Promise.resolve(undefined);
    },
  } as unknown as CouncilProviderRepository;
  const channelRepo = {} as unknown as CouncilChannelRepository;
  return { repos: { providerRepo, channelRepo }, updates };
}

function spyNotify() {
  const calls: Array<{ url: string; notice: ProviderRemovedNotice }> = [];
  const notify = (url: string, notice: ProviderRemovedNotice) => {
    calls.push({ url, notice });
  };
  return { notify, calls };
}

Deno.test("active provider removal marks REMOVED and notifies its backend once", async () => {
  const { repos, updates } = fakeRepos(providerRow({}));
  const { notify, calls } = spyNotify();

  await applyEvent(COUNCIL, removedEvent(7), repos, newNoop(), notify);

  assertEquals(updates.length, 1);
  assertEquals(updates[0].fields.status, ProviderStatus.REMOVED);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "https://pp.example.com");
  assertEquals(calls[0].notice, {
    councilId: COUNCIL,
    publicKey: PROVIDER_PK,
    ledger: 7,
  });
});

Deno.test("re-delivered/boot-replayed removal of an already-REMOVED provider does not re-notify", async () => {
  const { repos, updates } = fakeRepos(
    providerRow({ status: ProviderStatus.REMOVED }),
  );
  const { notify, calls } = spyNotify();

  await applyEvent(COUNCIL, removedEvent(), repos, newNoop(), notify);

  // Idempotent: the write still runs, but no second notify is sent.
  assertEquals(updates.length, 1);
  assertEquals(calls.length, 0);
});

Deno.test("provider with no provider_url is not notified (dormant)", async () => {
  const { repos } = fakeRepos(providerRow({ providerUrl: null }));
  const { notify, calls } = spyNotify();

  await applyEvent(COUNCIL, removedEvent(), repos, newNoop(), notify);

  assertEquals(calls.length, 0);
});

Deno.test("removal of an unknown provider is a no-op", async () => {
  const { repos, updates } = fakeRepos(undefined);
  const { notify, calls } = spyNotify();

  await applyEvent(COUNCIL, removedEvent(), repos, newNoop(), notify);

  assertEquals(updates.length, 0);
  assertEquals(calls.length, 0);
});
