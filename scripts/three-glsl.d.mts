import type { Plugin } from 'vite';
export const THREE_GLSL_FILE: RegExp;
export function stripGlsl(text: string): string;
export function stripGlslModule(code: string, where?: string): string;
export function threeGlsl(): Plugin;
