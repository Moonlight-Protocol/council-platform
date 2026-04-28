/**
 * Council Platform API Client
 *
 * Used by provider-platform to communicate with council-platform
 * for non-custodial UTXO key management.
 *
 * This module is designed to be copied into provider-platform's codebase
 * or published as a shared package.
 */

export interface CouncilClientConfig {
  baseUrl: string;
  providerToken: string; // JWT from council auth
}

export interface RegisterUserResult {
  userId: string;
  p256PublicKeyHex: string;
}

export interface SignSpendRequest {
  externalId: string;
  utxoIndex: number;
  message: string; // hex-encoded
}

export class CouncilClient {
  private baseUrl: string;
  private token: string;

  constructor(config: CouncilClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.providerToken;
  }

  updateToken(token: string): void {
    this.token = token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(
        json.message ?? `Council API error: ${response.status}`,
      );
    }

    return json.data as T;
  }

  /**
   * Register a non-custodial user with the council.
   * Returns the derived P256 root public key.
   */
  registerUser(
    externalId: string,
    channelContractId: string,
  ): Promise<RegisterUserResult> {
    return this.request<RegisterUserResult>("POST", "/council/sign/register", {
      externalId,
      channelContractId,
    });
  }

  /**
   * Get derived P256 public keys for a user at specific UTXO indices.
   */
  async getKeys(
    externalId: string,
    channelContractId: string,
    indices: number[],
  ): Promise<string[]> {
    const result = await this.request<{ publicKeys: string[] }>(
      "POST",
      "/council/sign/keys",
      { externalId, channelContractId, indices },
    );
    return result.publicKeys;
  }

  /**
   * Request P256 spend signatures from the council.
   * Returns hex-encoded DER signatures.
   */
  async signSpends(
    channelContractId: string,
    spends: SignSpendRequest[],
  ): Promise<string[]> {
    const result = await this.request<{ signatures: string[] }>(
      "POST",
      "/council/sign/spend",
      { channelContractId, spends },
    );
    return result.signatures;
  }

  // --- Escrow API ---

  /**
   * Check if a recipient has UTXO addresses for a channel.
   */
  checkRecipientUtxos(
    recipientAddress: string,
    channelContractId: string,
    count: number = 1,
  ): Promise<{ registered: boolean; publicKeys: string[] }> {
    return this.request<{ registered: boolean; publicKeys: string[] }>(
      "GET",
      `/council/recipient/${
        encodeURIComponent(recipientAddress)
      }/utxos?channelContractId=${
        encodeURIComponent(channelContractId)
      }&count=${count}`,
    );
  }

  /**
   * Deposit funds into escrow for a non-KYC'd recipient.
   */
  createEscrow(opts: {
    senderAddress: string;
    recipientAddress: string;
    amount: string;
    assetCode: string;
    channelContractId: string;
  }): Promise<{ escrowId: string }> {
    return this.request<{ escrowId: string }>("POST", "/council/escrow", opts);
  }

  /**
   * Get pending escrow summary for a recipient.
   */
  getEscrowSummary(
    recipientAddress: string,
  ): Promise<{
    pendingCount: number;
    pendingTotal: string;
    escrows: Array<{
      id: string;
      senderAddress: string;
      amount: string;
      assetCode: string;
      createdAt: string;
    }>;
  }> {
    return this.request(
      "GET",
      `/council/escrow/${encodeURIComponent(recipientAddress)}`,
    );
  }

  /**
   * Authenticate with the council as a provider.
   * Returns a JWT token for subsequent requests.
   */
  static async authenticate(
    baseUrl: string,
    publicKey: string,
    signChallenge: (nonce: string) => Promise<string>,
  ): Promise<string> {
    const base = baseUrl.replace(/\/+$/, "");

    // Step 1: Request challenge
    const challengeRes = await fetch(`${base}/api/v1/provider/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey }),
    });
    const challengeJson = await challengeRes.json();
    if (!challengeRes.ok) {
      throw new Error(challengeJson.message ?? "Failed to create challenge");
    }
    const nonce = challengeJson.data.nonce;

    // Step 2: Sign and verify
    const signature = await signChallenge(nonce);
    const verifyRes = await fetch(`${base}/api/v1/provider/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce, signature, publicKey }),
    });
    const verifyJson = await verifyRes.json();
    if (!verifyRes.ok) {
      throw new Error(verifyJson.message ?? "Authentication failed");
    }

    return verifyJson.data.token;
  }
}
