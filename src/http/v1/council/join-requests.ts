import { type Context, Status } from "@oak/oak";
import { and, eq, isNull } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ProviderJoinRequestRepository } from "@/persistence/drizzle/repository/provider-join-request.repository.ts";
import {
  JoinRequestStatus,
  providerJoinRequest,
} from "@/persistence/drizzle/entity/provider-join-request.entity.ts";
import {
  councilProvider,
  ProviderStatus,
} from "@/persistence/drizzle/entity/council-provider.entity.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import type { Logger } from "@/utils/logger/index.ts";

const metadataRepo = new CouncilMetadataRepository(drizzleClient);

const joinRequestRepo = new ProviderJoinRequestRepository(drizzleClient);

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
 * GET /council/provider-requests?councilId=...
 * Lists join requests for a council. Optional ?status= filter. Max 100 results.
 */
export function handleListJoinRequests(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("listJoinRequests");

  return async (ctx) => {
    log.info("listJoinRequests");
    try {
      const councilId = ctx.request.url.searchParams.get("councilId");
      if (!councilId) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "councilId query parameter is required",
        };
        return;
      }

      // Verify ownership
      const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
      const council = await metadataRepo.getByIdAndOwner(
        councilId,
        ownerPublicKey,
      );
      if (!council) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Council not found" };
        return;
      }

      const statusFilter = ctx.request.url.searchParams.get("status");

      let requests;
      if (statusFilter === "PENDING") {
        requests = await joinRequestRepo.listPending(councilId);
      } else {
        requests = await joinRequestRepo.listAll(councilId);
      }

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Join requests retrieved",
        data: requests.map(formatJoinRequest),
      };
    } catch (error) {
      log.error(error, "failed to list join requests");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve join requests" };
    }
  };
}

type RouteParams = { id?: string };

/**
 * POST /council/provider-requests/:id/approve
 * Approves a join request. On-chain add_provider is done client-side.
 * Returns the council config and callback endpoint so the client can
 * sign and push the config to the PP directly.
 */
export function handleApproveJoinRequest(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("approveJoinRequest");

  return async (ctx) => {
    log.info("approveJoinRequest");
    try {
      const params = (ctx as unknown as { params?: RouteParams }).params;
      const id = params?.id;

      if (!id) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Request ID is required" };
        return;
      }
      log.debug("id", id);

      const adminPublicKey = (ctx.state.session as { sub: string }).sub;

      // Verify the request's council is owned by this admin
      const requestRow = await joinRequestRepo.findById(id);
      if (!requestRow) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Join request not found" };
        return;
      }
      const council = await metadataRepo.getByIdAndOwner(
        requestRow.councilId,
        adminPublicKey,
      );
      if (!council) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Join request not found" };
        return;
      }

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

        // Create provider record if not exists for this council
        const [existing] = await tx
          .select()
          .from(councilProvider)
          .where(
            and(
              eq(councilProvider.councilId, row.councilId),
              eq(councilProvider.publicKey, row.publicKey),
            ),
          )
          .limit(1);

        if (!existing) {
          await tx.insert(councilProvider).values({
            id: crypto.randomUUID(),
            councilId: row.councilId,
            publicKey: row.publicKey,
            status: ProviderStatus.ACTIVE,
            label: row.label,
            contactEmail: row.contactEmail,
            providerUrl: row.providerUrl,
            jurisdictions: row.jurisdictions,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        return {
          ...row,
          status: JoinRequestStatus.APPROVED,
          reviewedAt: new Date(),
          reviewedBy: adminPublicKey,
        };
      });

      if (!request) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Join request not found" };
        return;
      }

      if (request.status !== JoinRequestStatus.APPROVED) {
        ctx.response.status = Status.Conflict;
        ctx.response.body = {
          message: `Request is already ${request.status}`,
        };
        return;
      }

      log.debug("providerKey", request.publicKey);
      log.event("join request approved");

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Join request approved",
        data: formatJoinRequest({
          ...request,
          status: JoinRequestStatus.APPROVED,
          reviewedAt: new Date(),
          reviewedBy: adminPublicKey,
        }),
      };
    } catch (error) {
      log.error(error, "failed to approve join request");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to approve join request" };
    }
  };
}

/**
 * POST /council/provider-requests/:id/reject
 * Rejects a join request. Stays visible in the list with REJECTED status.
 */
export function handleRejectJoinRequest(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("rejectJoinRequest");

  return async (ctx) => {
    log.info("rejectJoinRequest");
    try {
      const params = (ctx as unknown as { params?: RouteParams }).params;
      const id = params?.id;

      if (!id) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Request ID is required" };
        return;
      }
      log.debug("id", id);

      const adminPublicKey = (ctx.state.session as { sub: string }).sub;

      // Verify the request's council is owned by this admin
      const rejectRequestRow = await joinRequestRepo.findById(id);
      if (!rejectRequestRow) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Join request not found" };
        return;
      }
      const rejectCouncil = await metadataRepo.getByIdAndOwner(
        rejectRequestRow.councilId,
        adminPublicKey,
      );
      if (!rejectCouncil) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Join request not found" };
        return;
      }

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
            updatedAt: new Date(),
          })
          .where(eq(providerJoinRequest.id, id));

        return {
          ...row,
          status: JoinRequestStatus.REJECTED,
          reviewedAt: new Date(),
          reviewedBy: adminPublicKey,
        };
      });

      if (!request) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Join request not found" };
        return;
      }

      if (request.status !== JoinRequestStatus.REJECTED) {
        ctx.response.status = Status.Conflict;
        ctx.response.body = {
          message: `Request is already ${request.status}`,
        };
        return;
      }

      log.debug("providerKey", request.publicKey);
      log.event("join request rejected");

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Join request rejected",
        data: formatJoinRequest(request),
      };
    } catch (error) {
      log.error(error, "failed to reject join request");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to reject join request" };
    }
  };
}
