export const ROOT: string;
export const OUT: string;
export function isLoopback(host: string | true): boolean;
export function listenHost(argv?: string[], env?: Record<string, string | undefined>): string | true;
export function serve(o?: {
  port?: number;
  host?: string | true;
}): Promise<{url: string; network: string[]; close(): Promise<void>}>;
export const PHONE_PRESET: 'medium';
export const PRESETS: readonly ('reference' | 'high' | 'medium' | 'low')[];
export function viewPreset(name: string, quality: string | undefined): string | null;
