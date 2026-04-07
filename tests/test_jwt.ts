/**
 * JWT helpers for API integration tests.
 *
 * Generates valid JWTs signed with the same test secret used by the
 * mock_service_auth_secret.ts, so they pass the jwtMiddleware.
 *
 * There is no `type` claim — auth is unified, and per-endpoint
 * authorization is handled by the handlers themselves.
 */
import { create, getNumericDate } from "@zaubrik/djwt";
import { SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE } from "./mock_service_auth_secret.ts";

/** Create a valid wallet JWT for test requests. */
export async function createWalletJwt(publicKey: string): Promise<string> {
  return await create(
    { alg: "HS256", typ: "JWT" },
    {
      iss: "https://test.council.local",
      sub: publicKey,
      iat: getNumericDate(0),
      exp: getNumericDate(3600),
      sessionId: "test-session",
    },
    SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE,
  );
}
