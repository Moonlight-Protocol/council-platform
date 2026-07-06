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
import * as E from "@/http/v1/error.ts";
import { COUNCIL_NOT_FOUND, MISSING_COUNCIL_ID } from "./error.ts";
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
    const councilId = ctx.request.url.searchParams.get("councilId");
    if (!councilId) {
      throw new MISSING_COUNCIL_ID();
    }

    // Verify ownership
    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const council = await metadataRepo.getByIdAndOwner(
      councilId,
      ownerPublicKey,
    );
    if (!council) {
      throw new COUNCIL_NOT_FOUND();
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
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const id = params?.id;

    if (!id) {
      throw new E.RESOURCE_ID_REQUIRED("Request ID");
    }
    log.debug("id", id);

    const adminPublicKey = (ctx.state.session as { sub: string }).sub;

    // Verify the request's council is owned by this admin
    const requestRow = await joinRequestRepo.findById(id);
    if (!requestRow) {
      throw new E.RESOURCE_NOT_FOUND("Join request not found");
    }
    const council = await metadataRepo.getByIdAndOwner(
      requestRow.councilId,
      adminPublicKey,
    );
    if (!council) {
      throw new E.RESOURCE_NOT_FOUND("Join request not found");
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
      throw new E.RESOURCE_NOT_FOUND("Join request not found");
    }

    if (request.status !== JoinRequestStatus.APPROVED) {
      throw new E.RESOURCE_CONFLICT(`Request is already ${request.status}`);
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
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const id = params?.id;

    if (!id) {
      throw new E.RESOURCE_ID_REQUIRED("Request ID");
    }
    log.debug("id", id);

    const adminPublicKey = (ctx.state.session as { sub: string }).sub;

    // Verify the request's council is owned by this admin
    const rejectRequestRow = await joinRequestRepo.findById(id);
    if (!rejectRequestRow) {
      throw new E.RESOURCE_NOT_FOUND("Join request not found");
    }
    const rejectCouncil = await metadataRepo.getByIdAndOwner(
      rejectRequestRow.councilId,
      adminPublicKey,
    );
    if (!rejectCouncil) {
      throw new E.RESOURCE_NOT_FOUND("Join request not found");
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
      throw new E.RESOURCE_NOT_FOUND("Join request not found");
    }

    if (request.status !== JoinRequestStatus.REJECTED) {
      throw new E.RESOURCE_CONFLICT(`Request is already ${request.status}`);
    }

    log.debug("providerKey", request.publicKey);
    log.event("join request rejected");

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Join request rejected",
      data: formatJoinRequest(request),
    };
  };
}
