import type { Plugin } from 'vite';
export function compactSource(code: string, ids: Readonly<Record<string, string>>): string;
export function compactCatalog(json: string, ids: Readonly<Record<string, string>>, where?: string): string;
export function compactProblems(code: string, ids: Readonly<Record<string, string>>): string[];
export function compactKeys(idsFile: string): Plugin;
