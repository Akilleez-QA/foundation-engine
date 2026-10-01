import type { DocumentLimits, DocumentValue } from '../authoring/document';

declare const connectionHandle: unique symbol;
/** Opaque owner-local identity. Never a wire identifier or an authenticated principal. */
export interface ConnectionHandle { readonly [connectionHandle]: true }
export interface NetworkLimits {
  maxConnections: number;
  maxPendingAuth: number;
  maxPreAuthMessages: number;
  authTimeoutMs: number;
  maxQueuedMessagesPerPeer: number;
  maxQueuedBytesPerPeer: number;
  maxQueuedMessages: number;
  maxQueuedBytes: number;
  maxPumpOperations: number;
  message: DocumentLimits;
  principal: DocumentLimits;
}
export type NetworkReason = 'disposed' | 'busy' | 'unknown-peer' | 'closed' | 'not-active'
  | 'auth-state' | 'connection-limit' | 'auth-limit' | 'pre-auth-limit' | 'auth-timeout'
  | 'invalid-data' | 'queue-limit' | 'auth-rejected' | 'auth-error' | 'unauthorized'
  | 'authorize-error' | 'dispatch-error' | 'send-refused' | 'send-error' | 'revoked' | 'closed-by-owner';
export interface NetworkRefusal { readonly status: 'refused'; readonly reason: NetworkReason }
export interface NetworkContext {
  readonly peer: ConnectionHandle;
  readonly principal: DocumentValue;
  readonly command: DocumentValue;
}
export interface NetworkPorts {
  /** May complete later. null rejects; any other principal must be bounded JSON text. */
  authenticate(request: Readonly<{
    peer: ConnectionHandle;
    credential: DocumentValue;
    complete(principalJson: string | null): void;
  }>): void;
  /** Rechecked for every dispatched command. Must return literal true to permit. */
  authorize(context: NetworkContext): boolean;
  /** Synchronous admission to creator logic, not a transaction or durable acknowledgment. */
  dispatch(context: NetworkContext): void;
  /** true means transport admission only. Caller transport owns outgoing memory and delivery. */
  send(peer: ConnectionHandle, json: string): boolean;
  /** Called once, after membership, pending authentication and queued data are retired. */
  close(peer: ConnectionHandle, reason: NetworkReason): void;
}
export interface NetworkPeerState {
  readonly state: 'pre-auth' | 'pending-auth' | 'active' | 'closed';
  readonly principal: DocumentValue | null;
  readonly queuedMessages: number;
  readonly queuedBytes: number;
  readonly preAuthMessages: number;
  readonly reason: NetworkReason | null;
}
export interface NetworkStats {
  readonly connections: number;
  readonly pendingAuth: number;
  readonly queuedMessages: number;
  readonly queuedBytes: number;
  readonly disposed: boolean;
}
export interface NetworkPumpResult {
  readonly status: 'pumped';
  readonly attempted: number;
  readonly dispatched: number;
  readonly denied: number;
  readonly expired: number;
}
export interface NetworkIntake {
  open(now: number): Readonly<{ status: 'opened'; peer: ConnectionHandle }> | NetworkRefusal;
  authenticate(peer: ConnectionHandle, credentialJson: string, now: number): Readonly<{ status: 'started' }> | NetworkRefusal;
  receive(peer: ConnectionHandle, commandJson: string, now: number): Readonly<{ status: 'queued' }> | NetworkRefusal;
  pump(now: number, budget?: number): NetworkPumpResult | NetworkRefusal;
  send(peer: ConnectionHandle, json: string): Readonly<{ status: 'sent' }> | NetworkRefusal;
  close(peer: ConnectionHandle, reason?: NetworkReason): void;
  revoke(peer: ConnectionHandle): void;
  read(peer: ConnectionHandle): NetworkPeerState | null;
  stats(): NetworkStats;
  dispose(): void;
}
