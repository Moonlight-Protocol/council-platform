import { Keypair } from "stellar-sdk";
import { Buffer } from "buffer";
import { LOG } from "@/config/logger.ts";
import { withSpan } from "@/core/tracing.ts";

const MAX_PENDING_CHALLENGES = 1000;
let challengeTtlMs = 5 * 60 * 1000;

export function setChallengeTtlMs(ttlMs: number): void {
  challengeTtlMs = ttlMs;
}

interface PendingChallenge {
  nonce: string;
  publicKey: string;
  createdAt: number;
}

const pendingChallenges = new Map<string, PendingChallenge>();

export function createCouncilChallenge(publicKey: string): { nonce: string } {
  cleanupExpiredChallenges();
  if (pendingChallenges.size >= MAX_PENDING_CHALLENGES) {
    throw new Error("Too many pending challenges. Try again later.");
  }
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  pendingChallenges.set(nonce, { nonce, publicKey, createdAt: Date.now() });
  LOG.debug("Council challenge created", { publicKey });
  return { nonce };
}

export interface CouncilAuthConfig {
  councilPublicKey: string;
  horizonUrl?: string;
  generateToken: (subject: string, sessionId: string) => Promise<string>;
}

export async function verifyCouncilChallenge(
  nonce: string,
  signature: string,
  publicKey: string,
  config: CouncilAuthConfig,
): Promise<{ token: string }> {
  return withSpan("CouncilAuth.verify", async (span) => {
    span.addEvent("verifying_challenge", { "signer.publicKey": publicKey });

    const challenge = pendingChallenges.get(nonce);
    if (!challenge) {
      throw new Error("Challenge not found or expired");
    }

    if (Date.now() - challenge.createdAt > challengeTtlMs) {
      pendingChallenges.delete(nonce);
      throw new Error("Challenge expired");
    }

    if (challenge.publicKey !== publicKey) {
      throw new Error("Public key mismatch");
    }

    // Don't consume nonce yet — only delete after successful verification
    // to prevent an attacker from burning valid challenges with bad signatures.

    span.addEvent("verifying_signature");
    try {
      const keypair = Keypair.fromPublicKey(publicKey);
      const sigBuffer = /^[0-9a-f]+$/i.test(signature)
        ? Buffer.from(signature, "hex")
        : Buffer.from(signature, "base64");
      const nonceBytes = Buffer.from(nonce, "utf-8");

      // SEP-43 format
      const sep43Header = Buffer.alloc(6);
      sep43Header[0] = 0x00;
      sep43Header[1] = 0x00;
      sep43Header.writeUInt32BE(nonceBytes.length, 2);
      const sep43Payload = Buffer.concat([sep43Header, nonceBytes]);
      const sep43Hash = Buffer.from(await crypto.subtle.digest("SHA-256", sep43Payload));

      if (keypair.verify(sep43Hash, sigBuffer)) {
        span.addEvent("signature_verified_sep43");
      } else {
        // SEP-53 format
        const sep53Prefix = "Stellar Signed Message:\n";
        const sep53Payload = Buffer.concat([Buffer.from(sep53Prefix, "utf-8"), nonceBytes]);
        const sep53Hash = Buffer.from(await crypto.subtle.digest("SHA-256", sep53Payload));

        if (keypair.verify(sep53Hash, sigBuffer)) {
          span.addEvent("signature_verified_sep53");
        } else {
          // Raw format
          const rawNonce = Buffer.from(nonce, "base64");
          if (!keypair.verify(rawNonce, sigBuffer)) {
            throw new Error("Invalid signature");
          }
          span.addEvent("signature_verified_raw");
        }
      }
    } catch (e) {
      throw e instanceof Error && e.message === "Invalid signature" ? e : new Error("Invalid signature");
    }

    // Signature verified — consume the nonce (one-time use)
    pendingChallenges.delete(nonce);

    span.addEvent("checking_signer_authorization");
    const isAuth = await isAuthorizedSigner(publicKey, config.councilPublicKey, config.horizonUrl);
    if (!isAuth) {
      throw new Error("Signer is not authorized on the council account");
    }

    span.addEvent("issuing_jwt");
    const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce)));
    const hashedSessionId = Array.from(hashBytes.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const token = await config.generateToken(publicKey, hashedSessionId);

    LOG.info("Council auth successful", { publicKey });
    return { token };
  });
}

async function isAuthorizedSigner(
  signerKey: string,
  accountId: string,
  horizonUrl?: string,
): Promise<boolean> {
  if (signerKey === accountId) return true;
  if (!horizonUrl) {
    LOG.warn("No Horizon URL configured, falling back to direct key match only");
    return false;
  }
  try {
    const baseUrl = horizonUrl.replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/accounts/${accountId}`);
    if (!response.ok) {
      LOG.error("Failed to fetch account from Horizon", { status: response.status, accountId });
      return false;
    }
    const accountData = await response.json();
    const signers = accountData.signers as Array<{ key: string; weight: number }>;
    return signers.some((s) => s.key === signerKey && s.weight > 0);
  } catch (error) {
    LOG.error("Failed to verify signer authorization", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function cleanupExpiredChallenges(): void {
  const now = Date.now();
  for (const [nonce, challenge] of pendingChallenges) {
    if (now - challenge.createdAt > challengeTtlMs) {
      pendingChallenges.delete(nonce);
    }
  }
}
