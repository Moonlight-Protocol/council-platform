import { CHANNEL_AUTH_ID, CHALLENGE_TTL } from "@/config/env.ts";
import { EventWatcher } from "./event-watcher.process.ts";
import { setChallengeTtlMs } from "@/core/service/auth/council-auth.ts";
import { LOG } from "@/config/logger.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import { ProviderStatus } from "@/persistence/drizzle/entity/council-provider.entity.ts";

// Wire env CHALLENGE_TTL (seconds) to council auth (ms)
setChallengeTtlMs(CHALLENGE_TTL * 1000);

const providerRepo = new CouncilProviderRepository(drizzleClient);

export const eventWatcher = new EventWatcher({
  contractId: CHANNEL_AUTH_ID,
});

// Council processes ALL events — it needs a complete picture of all providers
eventWatcher.onEvent(async (event) => {
  switch (event.type) {
    case "provider_added": {
      LOG.info("Provider added on-chain", {
        address: event.address,
        ledger: event.ledger,
      });

      const existing = await providerRepo.findByPublicKey(event.address);
      if (existing) {
        // Re-activate if previously removed
        if (existing.status === ProviderStatus.REMOVED) {
          await providerRepo.update(existing.id, {
            status: ProviderStatus.ACTIVE,
            registeredByEvent: `ledger:${event.ledger}`,
            removedByEvent: null,
          });
          LOG.info("Provider re-activated", { address: event.address });
        }
      } else {
        await providerRepo.create({
          id: crypto.randomUUID(),
          publicKey: event.address,
          status: ProviderStatus.ACTIVE,
          registeredByEvent: `ledger:${event.ledger}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        LOG.info("Provider registered", { address: event.address });
      }
      break;
    }

    case "provider_removed": {
      LOG.info("Provider removed on-chain", {
        address: event.address,
        ledger: event.ledger,
      });

      const provider = await providerRepo.findByPublicKey(event.address);
      if (provider) {
        await providerRepo.update(provider.id, {
          status: ProviderStatus.REMOVED,
          removedByEvent: `ledger:${event.ledger}`,
        });
        LOG.info("Provider marked as removed", { address: event.address });
      }
      break;
    }

    case "contract_initialized": {
      LOG.info("Channel Auth contract initialized", {
        address: event.address,
        ledger: event.ledger,
      });
      break;
    }
  }
});

export async function startEventWatcher(): Promise<void> {
  await eventWatcher.start();
}

export function stopEventWatcher(): void {
  eventWatcher.stop();
}
