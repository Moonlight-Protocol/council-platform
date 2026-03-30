import { type Context, Status } from "@oak/oak";
import { eq, and, isNull } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ProviderJoinRequestRepository } from "@/persistence/drizzle/repository/provider-join-request.repository.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { CouncilJurisdictionRepository } from "@/persistence/drizzle/repository/council-jurisdiction.repository.ts";
import { providerJoinRequest, JoinRequestStatus } from "@/persistence/drizzle/entity/provider-join-request.entity.ts";
import { councilProvider, ProviderStatus } from "@/persistence/drizzle/entity/council-provider.entity.ts";
import { LOG } from "@/config/logger.ts";

const joinRequestRepo = new ProviderJoinRequestRepository(drizzleClient);
const providerRepo = new CouncilProviderRepository(drizzleClient);
const metadataRepo = new CouncilMetadataRepository(drizzleClient);
const channelRepo = new CouncilChannelRepository(drizzleClient);
const jurisdictionRepo = new CouncilJurisdictionRepository(drizzleClient);

function formatJoinRequest(r: {
  id: string;
  publicKey: string;
  label: string | null;
  contactEmail: string | null;
  jurisdictions: string | null;
  callbackEndpoint: string | null;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
}) {
  let parsedJurisdictions = null;
  try {
    parsedJurisdictions = r.jurisdictions ? JSON.parse(r.jurisdictions) : null;
  } catch {
    parsedJurisdictions = null;
  }
  return {
    id: r.id,
    publicKey: r.publicKey,
    label: r.label,
    contactEmail: r.contactEmail,
    jurisdictions: parsedJurisdictions,
    callbackEndpoint: r.callbackEndpoint,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewedBy: r.reviewedBy,
  };
}

/**
 * GET /council/provider-requests
 * Lists join requests. Optional ?status= filter. Max 100 results.
 */
export const listJoinRequestsHandler = async (ctx: Context) => {
  try {
    const statusFilter = ctx.request.url.searchParams.get("status");

    let requests;
    if (statusFilter === "PENDING") {
      requests = await joinRequestRepo.listPending();
    } else {
      requests = await joinRequestRepo.listAll();
    }

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Join requests retrieved",
      data: requests.slice(0, 100).map(formatJoinRequest),
    };
  } catch (error) {
    LOG.error("Failed to list join requests", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve join requests" };
  }
};

type RouteParams = { id?: string };

/**
 * POST /council/provider-requests/:id/approve
 * Approves a join request. On-chain add_provider is done client-side.
 * Returns the council config and callback endpoint so the client can
 * sign and push the config to the PP directly.
 */
export const approveJoinRequestHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const id = params?.id;

    if (!id) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Request ID is required" };
      return;
    }

    const adminPublicKey = (ctx.state.session as { sub: string }).sub;

    // Atomic read-check-update inside a transaction with row lock.
    // SELECT ... FOR UPDATE prevents concurrent approvals of the same request.
    const request = await drizzleClient.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(providerJoinRequest)
        .where(
          and(
            eq(providerJoinRequest.id, id),
            isNull(providerJoinRequest.deletedAt),
          ),
        )
        .for("update")
        .limit(1);

      if (!row) return null;
      if (row.status !== JoinRequestStatus.PENDING) return row;

      // Update request status
      await tx
        .update(providerJoinRequest)
        .set({
          status: JoinRequestStatus.APPROVED,
          reviewedAt: new Date(),
          reviewedBy: adminPublicKey,
          updatedAt: new Date(),
        })
        .where(eq(providerJoinRequest.id, id));

      // Create provider record if not exists
      const [existing] = await tx
        .select()
        .from(councilProvider)
        .where(eq(councilProvider.publicKey, row.publicKey))
        .limit(1);

      if (!existing) {
        await tx.insert(councilProvider).values({
          id: crypto.randomUUID(),
          publicKey: row.publicKey,
          status: ProviderStatus.ACTIVE,
          label: row.label,
          contactEmail: row.contactEmail,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      return { ...row, status: JoinRequestStatus.APPROVED, reviewedAt: new Date(), reviewedBy: adminPublicKey };
    });

    if (!request) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Join request not found" };
      return;
    }

    if (request.status !== JoinRequestStatus.APPROVED) {
      ctx.response.status = Status.Conflict;
      ctx.response.body = { message: `Request is already ${request.status}` };
      return;
    }

    // Build config payload for the client to sign and push
    const [metadata, channels, jurisdictions] = await Promise.all([
      metadataRepo.getConfig(),
      channelRepo.listAll(),
      jurisdictionRepo.listAll(),
    ]);

    const configPayload = metadata ? {
      councilName: metadata.name,
      councilPublicKey: metadata.councilPublicKey,
      channelAuthId: metadata.channelAuthId,
      channels: channels.map((ch) => ({
        channelContractId: ch.channelContractId,
        assetCode: ch.assetCode,
        assetContractId: ch.assetContractId,
      })),
      jurisdictions: jurisdictions.map((j) => ({
        countryCode: j.countryCode,
        label: j.label,
      })),
    } : null;

    LOG.info("Join request approved", { id, providerKey: request.publicKey });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Join request approved",
      data: {
        ...formatJoinRequest({
          ...request,
          status: JoinRequestStatus.APPROVED,
          reviewedAt: new Date(),
          reviewedBy: adminPublicKey,
        }),
        // Client uses these to sign and push config to the PP
        configPayload,
      },
    };
  } catch (error) {
    LOG.error("Failed to approve join request", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to approve join request" };
  }
};

/**
 * POST /council/provider-requests/:id/reject
 * Soft-rejects a join request (sets deletedAt for soft delete).
 */
export const rejectJoinRequestHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const id = params?.id;

    if (!id) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Request ID is required" };
      return;
    }

    const adminPublicKey = (ctx.state.session as { sub: string }).sub;

    const request = await drizzleClient.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(providerJoinRequest)
        .where(
          and(
            eq(providerJoinRequest.id, id),
            isNull(providerJoinRequest.deletedAt),
          ),
        )
        .for("update")
        .limit(1);

      if (!row) return null;
      if (row.status !== JoinRequestStatus.PENDING) return row;

      await tx
        .update(providerJoinRequest)
        .set({
          status: JoinRequestStatus.REJECTED,
          reviewedAt: new Date(),
          reviewedBy: adminPublicKey,
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(providerJoinRequest.id, id));

      return { ...row, status: JoinRequestStatus.REJECTED, reviewedAt: new Date(), reviewedBy: adminPublicKey };
    });

    if (!request) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Join request not found" };
      return;
    }

    if (request.status !== JoinRequestStatus.REJECTED) {
      ctx.response.status = Status.Conflict;
      ctx.response.body = { message: `Request is already ${request.status}` };
      return;
    }

    LOG.info("Join request rejected", { id, providerKey: request.publicKey });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Join request rejected",
      data: formatJoinRequest(request),
    };
  } catch (error) {
    LOG.error("Failed to reject join request", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to reject join request" };
  }
};
