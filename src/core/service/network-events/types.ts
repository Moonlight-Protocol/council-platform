import type { NetworkEventKind } from "@/persistence/drizzle/entity/network-event.entity.ts";

/**
 * Wire frame for a single network event. Sent over the public WS to
 * network-dashboard clients. Mirrors the network_events row shape but with an
 * ISO-string timestamp.
 */
export type NetworkEventFrame = {
  id: string;
  kind: NetworkEventKind;
  councilId: string;
  ledger: number | null;
  occurredAt: string;
  payload: Record<string, unknown>;
};

/** Server → client frames over the public WS. Discriminated by `type`. */
export type ServerFrame =
  | { type: "hello"; events: NetworkEventFrame[] }
  | { type: "event"; event: NetworkEventFrame };
