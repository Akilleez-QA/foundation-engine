export const TAP_REPORTER: '--test-reporter=tap';
export const TOTAL_KEYS: readonly string[];
export function testTotals(output: string): Record<string, string> | null;
export function childTestEnv(env?: Record<string, string | undefined>): Record<string, string | undefined>;
