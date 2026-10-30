export function judge(state: unknown, e: Record<string, unknown>): {ok: boolean; got: unknown};
export function runScript(
  script: {name: string; scene?: string; seed?: number; steps: Record<string, unknown>[]},
  url: string,
  runtime?: {
    directory?: string;
    launch?: (...args: unknown[]) => Promise<unknown>;
    open?: (...args: unknown[]) => Promise<unknown>;
  },
): Promise<{
  name: string;
  pass: boolean;
  terminal?: boolean;
  steps: {step: Record<string, unknown>; ok?: boolean; got?: unknown; file?: string}[];
  errors?: string[];
}>;
