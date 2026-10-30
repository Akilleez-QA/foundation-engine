export const MATCHERS: readonly string[];
export const STEPS: Record<string, unknown>;
export function matcherProblems(e: unknown, where: string): string[];
export function stepKind(step: Record<string, unknown>): string | undefined;
export function scriptProblems(script: unknown): string[];
export function assertScript(script: unknown, file?: string): void;
