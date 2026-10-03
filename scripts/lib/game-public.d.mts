import type {Plugin} from 'vite';
export const RESERVED: readonly string[];
export function publicFiles(dir: string): string[];
export function gamePublicDir(options?: {game?: string; shared?: string}): string;
export function publicProblems(dir: string, shared?: string): string[];
export function gamePublic(options?: {shared?: string}): Plugin;
