import { Router, type Context, Status } from "@oak/oak";
import { Keypair } from "stellar-sdk";
import { createCouncilChallenge, verifyCouncilChallenge } from "@/core/service/auth/council-auth.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import { ProviderStatus } from "@/persistence/drizzle/entity/council-provider.entity.ts";
import { lowRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";
import { LOG } from "@/config/logger.ts";

const providerRepo = new CouncilProviderRepository(drizzleClient);

/**
 * POST /provider/auth/challenge
 *
 * PP requests auth challenge. Same mechanism as admin auth,
 * but issues "provider" type JWT after verifying the PP is registered.
 */
const postProviderChallengeHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { publicKey } = body;

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

    // Issue challenge regardless of registration status — provider status
    // is checked at verify time. This prevents enumeration of registered providers.
    const { nonce } = createCouncilChallenge(publicKey);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Challenge created",
      data: { nonce },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Too many pending challenges")) {
      ctx.response.status = 429;
      ctx.response.body = { message };
      return;
    }
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to create challenge" };
  }
};

/**
 * POST /provider/auth/verify
 *
 * PP submits signed challenge. Verifies signature, checks PP is registered,
 * issues JWT with type "provider".
 */
const postProviderVerifyHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { nonce, signature, publicKey } = body;

    if (!nonce || !signature || !publicKey) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "nonce, signature, and publicKey are required" };
      return;
    }

    // Double-check PP is still active (could have been removed between challenge and verify)
    const provider = await providerRepo.findByPublicKey(publicKey);
    if (!provider || provider.status !== ProviderStatus.ACTIVE) {
      ctx.response.status = Status.Forbidden;
      ctx.response.body = { message: "Provider not registered or not active" };
      return;
    }

    const { token } = await verifyCouncilChallenge(nonce, signature, publicKey, {
      generateToken: (subject, sessionId) =>
        generateJwt(subject, sessionId, { type: "provider" }),
    });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Authentication successful",
      data: { token },
    };
  } catch (error) {
    LOG.warn("Provider auth failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.Unauthorized;
    ctx.response.body = { message: "Authentication failed" };
  }
};

const providerAuthRouter = new Router();

providerAuthRouter.post(
  "/provider/auth/challenge",
  lowRateLimitMiddleware,
  postProviderChallengeHandler,
);
providerAuthRouter.post(
  "/provider/auth/verify",
  lowRateLimitMiddleware,
  postProviderVerifyHandler,
);

export default providerAuthRouter;
