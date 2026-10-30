// Types for the parts of scripts/strings.mjs that TypeScript callers use (vite.config.ts, tests).
export function compactId(n: number): string;
export function generate(root: string): {
  source: string;
  narration: string;
  ids: string;
  errors: string[];
  keys: number;
  shards: number;
};
