import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import { LOG } from "@/config/logger.ts";

const providerRepo = new CouncilProviderRepository(drizzleClient);

function formatProvider(p: { id: string; publicKey: string; status: string; label: string | null; contactEmail: string | null; registeredByEvent: string | null }) {
  return {
    id: p.id,
    publicKey: p.publicKey,
    status: p.status,
    label: p.label,
    contactEmail: p.contactEmail,
    registeredByEvent: p.registeredByEvent,
  };
}

/**
 * GET /council/providers
 * Lists all providers registered with this council.
 * Query params: ?status=ACTIVE (optional filter)
 */
export const listProvidersHandler = async (ctx: Context) => {
  try {
    const statusFilter = ctx.request.url.searchParams.get("status");

    let providers;
    if (statusFilter === "ACTIVE") {
      providers = await providerRepo.listActive();
    } else {
      providers = await providerRepo.listAll();
    }

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Providers retrieved",
      data: providers.map(formatProvider),
    };
  } catch (error) {
    LOG.error("Failed to list providers", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve providers" };
  }
};

type RouteParams = { id?: string };

/**
 * GET /council/providers/:id
 * Gets a single provider's details.
 */
export const getProviderHandler = async (ctx: Context) => {
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

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Provider retrieved",
      data: formatProvider(provider),
    };
  } catch (error) {
    LOG.error("Failed to get provider", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve provider" };
  }
};

/**
 * PUT /council/providers/:id
 * Updates provider metadata (label, contact). Admin-only.
 * On-chain status is managed by the event watcher, not this endpoint.
 */
export const updateProviderHandler = async (ctx: Context) => {
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

    const body = await ctx.request.body.json();
    const { label, contactEmail } = body;

    await providerRepo.update(id, {
      label: label?.trim() ?? provider.label,
      contactEmail: contactEmail?.trim() ?? provider.contactEmail,
    });

    const updated = await providerRepo.findById(id);

    LOG.info("Provider metadata updated", { id, publicKey: provider.publicKey });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Provider updated",
      data: formatProvider(updated!),
    };
  } catch {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid request body" };
  }
};
