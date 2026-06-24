import type { Logger } from "@/utils/logger/index.ts";
import type { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import type { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { ProviderStatus } from "@/persistence/drizzle/entity/council-provider.entity.ts";
import { ChannelStatus } from "@/persistence/drizzle/entity/council-channel.entity.ts";
import type { ChannelAuthEvent } from "./event-watcher.types.ts";

/**
 * Apply a single Channel Auth event to the council tables, using the
 * transaction-bound repositories passed in so the write joins the poll's atomic
 * commit.
 *
 * Kept free of any env-bound imports so it can be unit-tested with fake repos
 * (importing the watcher's index.ts would pull in `@/config/env.ts`, which
 * requires DATABASE_URL at module load).
 */
export async function applyEvent(
  councilId: string,
  event: ChannelAuthEvent,
  repos: {
    providerRepo: CouncilProviderRepository;
    channelRepo: CouncilChannelRepository;
  },
  log: Logger,
): Promise<void> {
  const { providerRepo, channelRepo } = repos;
  switch (event.type) {
    case "provider_added": {
      log.debug("councilId", councilId);
      log.debug("address", event.address);
      log.debug("ledger", event.ledger);
      log.event("provider added on-chain");

      const existing = await providerRepo.findByPublicKey(
        councilId,
        event.address,
      );
      if (existing) {
        if (existing.status === ProviderStatus.REMOVED) {
          await providerRepo.update(existing.id, {
            status: ProviderStatus.ACTIVE,
            registeredByEvent: `ledger:${event.ledger}`,
            removedByEvent: null,
          });
          log.event("provider re-activated");
        }
      } else {
        await providerRepo.create({
          id: crypto.randomUUID(),
          councilId,
          publicKey: event.address,
          status: ProviderStatus.ACTIVE,
          registeredByEvent: `ledger:${event.ledger}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        log.event("provider registered");
      }
      break;
    }

    case "provider_removed": {
      log.debug("councilId", councilId);
      log.debug("address", event.address);
      log.debug("ledger", event.ledger);
      log.event("provider removed on-chain");

      const provider = await providerRepo.findByPublicKey(
        councilId,
        event.address,
      );
      if (provider) {
        await providerRepo.update(provider.id, {
          status: ProviderStatus.REMOVED,
          removedByEvent: `ledger:${event.ledger}`,
        });
        log.event("provider marked as removed");
      }
      break;
    }

    case "channel_state_changed": {
      // SOLE authoritative writer of channel status. The DB only ever reflects
      // CONFIRMED on-chain state — never written ahead of the chain. Any
      // optimistic pendingAction marker is cleared here on confirmation.
      const channel = event.channel ?? event.address;
      const status = event.enabled
        ? ChannelStatus.ENABLED
        : ChannelStatus.DISABLED;
      log.debug("councilId", councilId);
      log.debug("channel", channel);
      log.debug("asset", event.asset ?? "");
      log.debug("ledger", event.ledger);
      log.debug("status", status);
      log.event("channel state changed on-chain");

      const updated = await channelRepo.setStatusByContractId(
        councilId,
        channel,
        status,
      );
      if (updated) {
        log.event("channel status reconciled from chain");
      } else {
        log.event("channel state event for unknown channel (ignored)");
      }
      break;
    }

    case "contract_initialized": {
      log.debug("councilId", councilId);
      log.debug("address", event.address);
      log.debug("ledger", event.ledger);
      log.event("channel auth contract initialized");
      break;
    }
  }
}
