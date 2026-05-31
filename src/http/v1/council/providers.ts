import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import { requireCouncilId, requireCouncilOwnership } from "./helpers.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import type { Logger } from "@/utils/logger/index.ts";

const metadataRepo = new CouncilMetadataRepository(drizzleClient);

const providerRepo = new CouncilProviderRepository(drizzleClient);

function formatProvider(
  p: {
    id: string;
    publicKey: string;
    status: string;
    label: string | null;
    contactEmail: string | null;
    registeredByEvent: string | null;
  },
) {
  return {
    id: p.id,
    publicKey: p.publicKey,
    status: p.status,
    label: p.label,
    contactEmail: p.contactEmail,
    registeredByEvent: p.registeredByEvent,
  };
}

export function handleListProviders(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("listProviders");

  return async (ctx) => {
    log.info("listProviders");
    try {
      const councilId = requireCouncilId(ctx);
      if (!councilId) return;
      if (!await requireCouncilOwnership(ctx, councilId, metadataRepo)) return;

      const statusFilter = ctx.request.url.searchParams.get("status");

      let providers;
      if (statusFilter === "ACTIVE") {
        providers = await providerRepo.listActive(councilId);
      } else {
        providers = await providerRepo.listAll(councilId);
      }

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Providers retrieved",
        data: providers.map(formatProvider),
      };
    } catch (error) {
      log.error(error, "failed to list providers");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve providers" };
    }
  };
}

type RouteParams = { id?: string };

export function handleGetProvider(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getProvider");

  return async (ctx) => {
    log.info("getProvider");
    try {
      const params = (ctx as unknown as { params?: RouteParams }).params;
      const id = params?.id;

      if (!id) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Provider ID is required" };
        return;
      }

      const provider = await providerRepo.findById(id);
      if (!provider) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Provider not found" };
        return;
      }

      if (
        !await requireCouncilOwnership(ctx, provider.councilId, metadataRepo)
      ) {
        return;
      }

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Provider retrieved",
        data: formatProvider(provider),
      };
    } catch (error) {
      log.error(error, "failed to get provider");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve provider" };
    }
  };
}

export function handleUpdateProvider(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("updateProvider");

  return async (ctx) => {
    log.info("updateProvider");
    try {
      const params = (ctx as unknown as { params?: RouteParams }).params;
      const id = params?.id;

      if (!id) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Provider ID is required" };
        return;
      }

      const provider = await providerRepo.findById(id);
      if (!provider) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Provider not found" };
        return;
      }

      if (
        !await requireCouncilOwnership(ctx, provider.councilId, metadataRepo)
      ) {
        return;
      }

      const body = await ctx.request.body.json();
      const { label, contactEmail } = body;

      await providerRepo.update(id, {
        label: label?.trim() ?? provider.label,
        contactEmail: contactEmail?.trim() ?? provider.contactEmail,
      });

      const updated = await providerRepo.findById(id);

      log.debug("id", id);
      log.debug("publicKey", provider.publicKey);
      log.event("provider metadata updated");

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Provider updated",
        data: formatProvider(updated!),
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Invalid request body" };
      } else {
        log.error(error, "failed to update provider");
        ctx.response.status = Status.InternalServerError;
        ctx.response.body = { message: "Failed to update provider" };
      }
    }
  };
}
