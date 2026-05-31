import { type Context, Status } from "@oak/oak";
import { verifyCouncilChallenge } from "@/core/service/auth/council-auth.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { WalletUserRepository } from "@/persistence/drizzle/repository/wallet-user.repository.ts";
import type { Logger } from "@/utils/logger/index.ts";

const walletUserRepo = new WalletUserRepository(drizzleClient);

export function handlePostVerify(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postVerify");

  return async (ctx) => {
    log.info("postVerify");
    try {
      const body = await ctx.request.body.json();
      const { nonce, signature, publicKey } = body;

      if (!nonce || !signature || !publicKey) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "nonce, signature, and publicKey are required",
        };
        return;
      }

      const { token } = await verifyCouncilChallenge(
        nonce,
        signature,
        publicKey,
        {
          generateToken: (subject, sessionId) =>
            generateJwt(subject, sessionId),
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
    } catch (error) {
      log.error(error, "council auth failed");
      ctx.response.status = Status.Unauthorized;
      ctx.response.body = { message: "Authentication failed" };
    }
  };
}
