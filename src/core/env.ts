/** Build flags, read once. The one sanctioned scene that casts `import.meta` (lint rule dev-flag-cast). */
export const DEV: boolean = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
/** Test API and probes record (ADR 0026): the dev server or a `vite build --mode test` build. False in production and under tsx. */
export const TEST_API: boolean = DEV || (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE === 'test';
/** Registry `validate`/`problems` run: in the dev server, a test build and under tsx. A production build
 *  leaves them out to keep first-load flat; the same checks gate every shipped row in CI (core/registries.test.ts). */
export const REGISTRY_CHECKS: boolean = TEST_API || (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD !== true;
