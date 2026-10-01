export const ROOT: string;
export const OUT: string;
export function serve(o?: {port?: number}): Promise<{url: string; close(): Promise<void>}>;
