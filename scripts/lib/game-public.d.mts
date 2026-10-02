import type {Plugin} from 'vite';
export function publicFiles(dir: string): string[];
export function conflicts(gamePublicDir: string, sharedDir: string): string[];
export function resolveRequest(dir: string, pathname: string, base?: string): string | null;
export function gamePublic(options?: {dir?: () => string; shared?: string}): Plugin;
