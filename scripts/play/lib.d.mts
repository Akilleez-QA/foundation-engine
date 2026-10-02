export const ROOT: string;
export const OUT: string;
export function isLoopback(host: string | true): boolean;
export function listenHost(argv?: string[], env?: Record<string, string | undefined>): string | true;
export function serve(o?: {port?: number; host?: string | true}): Promise<{url: string; network: string[]; close(): Promise<void>}>;
