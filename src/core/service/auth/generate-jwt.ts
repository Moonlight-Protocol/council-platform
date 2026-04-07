import { create, getNumericDate } from "@zaubrik/djwt";
import { SERVICE_DOMAIN, SESSION_TTL } from "@/config/env.ts";
import { SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE } from "@/core/service/auth/service/service-auth-secret.ts";

export type JwtPayload = {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  sessionId: string;
};

/**
 * Generates a wallet-auth JWT. Authorization is per-endpoint based on the
 * wallet identity (sub): admin endpoints check council ownership, provider
 * endpoints check council membership. There is no `type` claim — every wallet
 * authenticates the same way and the data decides what they can do.
 */
export default async function (
  clientAccount: string,
  challengeHash: string,
) {
  const header = { alg: "HS256", typ: "JWT" } as const;

  const payload: Record<string, unknown> = {
    iss: "https://" + SERVICE_DOMAIN,
    sub: clientAccount,
    iat: getNumericDate(0),
    exp: getNumericDate(SESSION_TTL),
    sessionId: challengeHash,
  };

  const secretKey = SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE;
  const jwt = await create(header, payload, secretKey);
  return jwt;
}
