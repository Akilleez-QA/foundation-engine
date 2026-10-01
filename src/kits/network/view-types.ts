import type { DocumentValue } from '../authoring/document';
/** Hard admission bounds for the complete envelope, not transport memory limits. */
export type ViewLimits = Readonly<{
  maxBytes: number; maxNodes: number; maxDepth: number; maxEntities: number; maxIdentityLength: number;
}>;
export type ViewEntity = Readonly<{ id: string; incarnation: number; fields: DocumentValue }>;
export type ViewFrame = Readonly<{
  v: 1; type: 'view'; session: string; sequence: number; worldRevision: number; entities: readonly ViewEntity[];
}>;
export type ViewUnavailableFrame = Readonly<{
  v: 1; type: 'view-unavailable'; session: string; sequence: number; reason: string;
}>;
export type ViewReceiveResult = Readonly<{
  status: 'accepted' | 'unavailable' | 'duplicate' | 'obsolete' | 'foreign' | 'retired';
}>;
export type ViewReceiverState = Readonly<{
  state: 'waiting' | 'ready' | 'unavailable' | 'retired'; session: string;
  sequence: number; view: ViewFrame | null; reason: string | null;
}>;
export type ViewReceiver = Readonly<{
  receive(json: string): ViewReceiveResult; read(): ViewReceiverState;
  /** Clears active data, keeps ordering floor; only a newer frame recovers. */
  invalidate(reason?: string): void; dispose(): void;
}>;
export type ViewPublisherPorts = Readonly<{
  /** Current authority for this exact caller-owned connection/session. */
  current(): boolean;
  /** Creator disclosure: JSON with exactly worldRevision and entities. */
  project(): string;
  /** True means transport admission only. */
  send(json: string): boolean;
  /** Owner is already retired and cleared when this cleanup callback runs. */
  retire(reason: string): void;
}>;
export type ViewPublisherState = Readonly<{
  state: 'active' | 'retired'; session: string; sequence: number;
  outstanding: Readonly<{ sequence: number; bytes: number }> | null; dirty: boolean; reason: string | null;
}>;
export type ViewPumpResult = Readonly<{
  status: 'sent' | 'waiting' | 'idle' | 'superseded' | 'busy' | 'retired'; sequence?: number;
}>;
export type ViewPublisher = Readonly<{
  pump(): ViewPumpResult; markDirty(): void; invalidateDisclosure(): void;
  ack(session: string, sequence: number): boolean; read(): ViewPublisherState; dispose(): void;
}>;
