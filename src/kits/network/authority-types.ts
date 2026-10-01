import type { DocumentValue } from '../authoring/document';
import type { JsonLimits } from './captured-json';

export interface AuthorityLimits {
  readonly envelope: JsonLimits;
  readonly state: JsonLimits;
  readonly input: JsonLimits;
  readonly result: JsonLimits;
  readonly maxStreams: number;
  readonly maxReceiptsPerStream: number;
}
export interface AuthorityReceipt {
  readonly sequence: number;
  readonly revision: number;
  readonly input: DocumentValue;
  readonly result: DocumentValue;
}
export interface AuthorityStream {
  readonly id: string;
  readonly through: number;
  readonly receipts: readonly AuthorityReceipt[];
}
export interface AuthorityEnvelope {
  readonly version: 1;
  readonly lineage: string;
  readonly schema: string;
  readonly revision: number;
  readonly state: DocumentValue;
  readonly streams: readonly AuthorityStream[];
}
/** Committed means the entire candidate is durable under the adapter's declared failure model. */
export interface AuthorityStorage {
  /** Fence/finish every prior adapter write before allowing physical recovery reads. */
  settle(): Promise<void>;
  read(): Promise<string | null>;
  compareAndSwap(
    request: Readonly<{
      lineage: string;
      schema: string;
      revision: number;
      json: string;
    }>,
  ): Promise<'committed' | 'rejected' | 'unknown'>;
}
export interface AuthorityValidation {
  readonly lineage: string;
  readonly schema: string;
  readonly limits: AuthorityLimits;
  validateState(value: DocumentValue): boolean;
  validateInput(value: DocumentValue): boolean;
  validateResult(value: DocumentValue): boolean;
}
export interface AuthorityCommand {
  readonly stream: string;
  readonly sequence: number;
  readonly inputJson: string;
}
export interface AuthorityReduction {
  readonly stream: string;
  readonly sequence: number;
  readonly input: DocumentValue;
  readonly state: DocumentValue;
}
export interface AuthorityOptions extends AuthorityValidation {
  readonly minimumRevision?: number;
  readonly storage: AuthorityStorage;
  /** Access permission, including current permission to disclose historical results. Not domain validation. */
  authorize(context: AuthorityReduction): boolean;
  /** Pure creator policy; unchanged state plus a result can represent a consumed domain rejection. */
  reduce(
    context: AuthorityReduction,
  ): Readonly<{ stateJson: string; resultJson: string }>;
}
export type AuthorityStatus =
  | 'unrecovered'
  | 'ready'
  | 'pending'
  | 'unknown'
  | 'unavailable'
  | 'retired';
export type AuthorityOutcome =
  | Readonly<{
      status: 'committed' | 'duplicate';
      revision: number;
      sequence: number;
      result: DocumentValue;
    }>
  | Readonly<{ status: 'recovered'; revision: number }>
  | Readonly<{ status: 'refused'; reason: string }>
  | Readonly<{
      status:
        | 'busy'
        | 'unknown'
        | 'unavailable'
        | 'retired'
        | 'result-unavailable'
        | 'conflict'
        | 'gap'
        | 'exhausted';
    }>;
export interface AuthoritySnapshot {
  readonly envelope: AuthorityEnvelope;
  readonly json: string;
  readonly bytes: number;
}
