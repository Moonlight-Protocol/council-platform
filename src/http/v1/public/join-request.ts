import { type Context, Status } from "@oak/oak";
import { Keypair } from "stellar-sdk";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ProviderJoinRequestRepository } from "@/persistence/drizzle/repository/provider-join-request.repository.ts";
import { JoinRequestStatus } from "@/persistence/drizzle/entity/provider-join-request.entity.ts";
import { LOG } from "@/config/logger.ts";

const joinRequestRepo = new ProviderJoinRequestRepository(drizzleClient);

/**
 * POST /public/provider/join-request
 * Submit a join request. No auth required.
 */
export const postJoinRequestHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { publicKey, label, contactEmail } = body;

    if (!publicKey || typeof publicKey !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "publicKey is required" };
      return;
    }

    try {
      Keypair.fromPublicKey(publicKey);
    } catch {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid Stellar public key format" };
      return;
    }

    if (label && typeof label !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "label must be a string" };
      return;
    }
    if (label && label.length > 200) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "label must be at most 200 characters" };
      return;
    }

    if (contactEmail && typeof contactEmail !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "contactEmail must be a string" };
      return;
    }
    if (contactEmail && contactEmail.length > 200) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "contactEmail must be at most 200 characters" };
      return;
    }

    // Check for existing pending request
    const existing = await joinRequestRepo.findPendingByPublicKey(publicKey);
    if (existing) {
      ctx.response.status = Status.Conflict;
      ctx.response.body = { message: "A pending join request already exists for this public key" };
      return;
    }

    const request = await joinRequestRepo.create({
      id: crypto.randomUUID(),
      publicKey,
      label: label?.trim() ?? null,
      contactEmail: contactEmail?.trim() ?? null,
      status: JoinRequestStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    LOG.info("Join request submitted", { publicKey });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Join request submitted",
      data: {
        id: request.id,
        publicKey: request.publicKey,
        status: request.status,
      },
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
    } else {
      LOG.error("Failed to create join request", { error: error instanceof Error ? error.message : String(error) });
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to submit join request" };
    }
  }
};
