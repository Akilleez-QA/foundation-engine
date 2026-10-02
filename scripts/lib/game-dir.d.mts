export const ROOT: string;
export const DEFAULT_TEMPLATE: string;
export function gameDir(env?: Record<string, string | undefined>): string;
export function gameDirLabel(dir?: string): string;
export function gameArg(argv?: string[]): string | undefined;
export function templateGameDirs(root?: string): string[];
export function gameDirProblem(env?: Record<string, string | undefined>): string | null;
