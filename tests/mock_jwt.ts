/**
 * Mock JWT generator for tests.
 *
 * Replaces @/core/service/auth/generate-jwt.ts so that auth handlers
 * can issue tokens without needing SERVICE_AUTH_SECRET or env vars.
 */

export type JwtPayload = {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  sessionId: string;
  type?: "admin" | "provider";
};

export default async function generateJwt(
  clientAccount: string,
  challengeHash: string,
  opts?: { type?: "admin" | "provider" },
): Promise<string> {
  const typePrefix = opts?.type ?? "admin";
  return `mock-jwt-${typePrefix}-${clientAccount}`;
}
