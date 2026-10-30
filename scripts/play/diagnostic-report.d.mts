export function describeDiagnostic(value: unknown): string;
export function diagnosticReport(
  report: Record<string, unknown>,
  path: string,
  write?: (path: string, data: string) => void,
): {
  fail(error: unknown, stage?: string): void;
  close(owner: {close(): unknown} | null | undefined, stage: string): Promise<void>;
  finish(): void;
};

export function writeDiagnosticEvidence(
  report: {errors: string[]; pass?: boolean; terminal?: boolean},
  write: () => unknown,
): void;
