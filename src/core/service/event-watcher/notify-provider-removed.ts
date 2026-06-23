import type { Logger } from "@/utils/logger/index.ts";

/** Notice payload sent to a removed PP's backend. */
export interface ProviderRemovedNotice {
  /** Council id == the channel-auth contract id that emitted the removal. */
  councilId: string;
  /** Public key of the provider that was removed. */
  publicKey: string;
  /** Ledger the removal event was observed at. */
  ledger: number;
}

export type NotifyProviderRemoved = (
  providerUrl: string,
  notice: ProviderRemovedNotice,
  deps: { log: Logger },
) => void;

/**
 * Fire-and-forget POST telling a removed PP's backend to re-check its
 * membership with the council.
 *
 * This is a LOW-TRUST live signal, not an authority: the body is a hint that
 * "something changed for you, re-query now". The PP converges by calling the
 * council's authoritative `/public/provider/membership-status` endpoint, so the
 * notice needs no shared secret and a spurious or replayed POST can only make a
 * provider re-confirm its own status against the council.
 *
 * It is NEVER awaited so it cannot stall — or roll back — the watcher's atomic
 * poll commit (the same fire-and-forget shape as {@link notifyDiscord}). It is
 * dormant when the provider row carries no `provider_url`; the caller skips it.
 */
export const notifyProviderRemoved: NotifyProviderRemoved = (
  providerUrl,
  notice,
  deps,
) => {
  const log = deps.log.scope("notifyProviderRemoved");
  const url = `${providerUrl.replace(/\/+$/, "")}/api/v1/council/removed`;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(notice),
  })
    .then((res) => {
      if (!res.ok) {
        log.error(
          new Error(`provider responded ${res.status}`),
          "provider removal notify non-2xx",
        );
      } else {
        log.event("provider removal notify delivered");
      }
    })
    .catch((err) => log.error(err, "provider removal notify failed"));
};
