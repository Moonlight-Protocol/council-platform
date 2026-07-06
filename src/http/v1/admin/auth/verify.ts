import { type Context, Status } from "@oak/oak";
import { verifyCouncilChallenge } from "@/core/service/auth/council-auth.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { WalletUserRepository } from "@/persistence/drizzle/repository/wallet-user.repository.ts";
import * as E from "@/http/v1/error.ts";
import type { Logger } from "@/utils/logger/index.ts";

const walletUserRepo = new WalletUserRepository(drizzleClient);

export function handlePostVerify(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postVerify");

  return async (ctx) => {
    log.info("postVerify");

    let body;
    try {
      body = await ctx.request.body.json();
    } catch (error) {
      throw new E.INVALID_REQUEST_BODY(error);
    }
    const { nonce, signature, publicKey } = body;

    if (!nonce || !signature || !publicKey) {
      throw new E.VALIDATION_FAILED(
        "nonce, signature, and publicKey are required",
      );
    }

    // verifyCouncilChallenge throws structured COUNCIL_AUTH_* errors (401/429)
    // that the edge translates with their specific codes — no blanket
    // "Authentication failed" swallow.
    const { token } = await verifyCouncilChallenge(
      nonce,
      signature,
      publicKey,
      {
        generateToken: (subject, sessionId) => generateJwt(subject, sessionId),
      },
      { log },
    );

    await walletUserRepo.findOrCreate(publicKey);

    log.event("authentication successful");
    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Authentication successful",
      data: { token },
    };
  };
}
