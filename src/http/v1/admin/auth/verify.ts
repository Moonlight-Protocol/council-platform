import { type Context, Status } from "@oak/oak";
import { verifyCouncilChallenge } from "@/core/service/auth/council-auth.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { WalletUserRepository } from "@/persistence/drizzle/repository/wallet-user.repository.ts";
import { LOG } from "@/config/logger.ts";

const walletUserRepo = new WalletUserRepository(drizzleClient);

export const postVerifyHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { nonce, signature, publicKey } = body;

    if (!nonce || !signature || !publicKey) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "nonce, signature, and publicKey are required" };
      return;
    }

    const { token } = await verifyCouncilChallenge(nonce, signature, publicKey, {
      generateToken: (subject, sessionId) => generateJwt(subject, sessionId, { type: "admin" }),
    });

    await walletUserRepo.findOrCreate(publicKey);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Authentication successful",
      data: { token },
    };
  } catch (error) {
    LOG.warn("Council auth failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.Unauthorized;
    ctx.response.body = { message: "Authentication failed" };
  }
};
