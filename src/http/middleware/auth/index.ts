import type { Context } from "@oak/oak";
import { verify } from "@zaubrik/djwt";
import { SERVICE_AUTH_SECRET_AS_CRYPTO_KEY } from "@/core/service/auth/service/service-auth-secret.ts";
import type { JwtPayload } from "@/core/service/auth/generate-jwt.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { isDefined } from "@/utils/type-guards/is-defined.ts";
import * as E from "@/http/middleware/auth/error.ts";
import { PlatformError } from "@/error/index.ts";

export function jwtMiddleware(
  deps: { log: Logger },
): (ctx: Context, next: () => Promise<unknown>) => Promise<void> {
  // deps kept for signature parity with the other middleware factories.
  void deps;
  return async (ctx, next) => {
    const authorization = ctx.request.headers.get("authorization");
    if (!isDefined(authorization)) {
      throw new E.MISSING_AUTHORIZATION_HEADER();
    }

    const parts = authorization.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      throw new E.INVALID_AUTHORIZATION_HEADER();
    }
    const token = parts[1];

    try {
      const secretKey = SERVICE_AUTH_SECRET_AS_CRYPTO_KEY;
      const payload = await verify(token, secretKey);

      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.exp === "number" && now > payload.exp) {
        throw new E.EXPIRED_TOKEN();
      }

      ctx.state.session = payload;
    } catch (error) {
      // Preserve already-structured auth errors; wrap the raw verify() failure.
      if (PlatformError.is(error)) throw error;
      throw new E.JWT_VERIFICATION_FAILED(error);
    }
    await next();
  };
}

export type JwtSessionData = JwtPayload;
