export function judge(state: unknown, e: Record<string, unknown>): {ok: boolean; got: unknown};
export function runScript(
  script: {name: string; scene?: string; seed?: number; steps: Record<string, unknown>[]},
  url: string,
): Promise<{
  name: string;
  pass: boolean;
  steps: {step: Record<string, unknown>; ok?: boolean; got?: unknown; file?: string}[];
  errors?: string[];
}>;
