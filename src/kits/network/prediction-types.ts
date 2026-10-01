import type { DocumentValue } from '../authoring/document';
import type { JsonLimits } from './captured-json';

export interface PredictionValue {
  readonly value: DocumentValue;
  readonly json: string;
  readonly bytes: number;
}
export interface PredictionInput extends PredictionValue { readonly sequence: number }
export interface PredictionBaseline {
  readonly epoch: string;
  readonly revision: number;
  readonly processedThrough: number;
  readonly stateJson: string;
}
export interface PredictionLimits {
  readonly state: JsonLimits;
  readonly input: JsonLimits;
  readonly maxPending: number;
  readonly maxPendingBytes: number;
  readonly maxReplaySteps: number;
}
export interface PredictionSnapshot {
  readonly status: 'ready' | 'unavailable' | 'retired';
  readonly epoch: string;
  /** Stale display only when unavailable; never permission to mutate accepted game state. */
  readonly confirmed: Readonly<{ revision: number; processedThrough: number; state: PredictionValue }> | null;
  readonly predicted: PredictionValue | null;
  readonly pending: readonly PredictionInput[];
  readonly pendingBytes: number;
  readonly issuedThrough: number;
  readonly correction: Readonly<{ changed: boolean; replayed: number }> | null;
  readonly reason: string | null;
}
export type PredictionRefusal = Readonly<{ status: 'busy' | 'unavailable' | 'retired' }>;
export interface Prediction {
  /** Already codec-normalized JSON. Resend the returned input; pushing again predicts a NEW input. */
  push(inputJson: string): Readonly<{ status: 'predicted'; input: PredictionInput }> | PredictionRefusal;
  reconcile(baseline: PredictionBaseline): Readonly<{ status: 'reconciled' | 'duplicate' | 'obsolete' | 'foreign' }> | PredictionRefusal;
  read(): PredictionSnapshot;
  /** Immediate even inside a callback. Recovery constructs a new trusted control owner. */
  invalidate(reason?: string): void;
  dispose(): void;
}
export interface PredictionOptions {
  readonly epoch: string;
  readonly baseline: Omit<PredictionBaseline, 'epoch'>;
  readonly limits: PredictionLimits;
  readonly validateState: (value: DocumentValue) => boolean;
  readonly validateInput: (value: DocumentValue) => boolean;
  /** Synchronous pure creator code. No clocks, effects, storage or ECS mutation; not sandboxed. */
  readonly reduce: (state: DocumentValue, input: DocumentValue) => string;
}
